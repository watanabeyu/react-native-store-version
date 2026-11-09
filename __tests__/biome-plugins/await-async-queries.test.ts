// U5 の GritQL ルール（biome-plugins/await-async-queries.grit）の回帰テスト。fixture を Biome で lint し、
// 診断が出る行が fixture の `// detect` の行と一致する（`// ok` の行には出ない）ことを確かめる。
// Biome のバージョンを上げてルールが効かなくなった（GritQL の構文や Biome のノード名が変わった）ときに気づくため。
//
// fixture は通常の lint の対象外なので、plugin だけを有効にした設定（plugin.biome.json）を --config-path で渡す。
// 名前を biome.json にしないのは、入れ子の root 設定としてリポジトリの biome.json と衝突するため。
// @types/node は入れていないので、node の API は jest.requireActual で型を付けて使う（__helpers__/fetch.ts と同じ）
declare const __dirname: string;
declare const process: { execPath: string };

const { spawnSync } = jest.requireActual<{
  spawnSync(
    command: string,
    args: string[],
    options: { cwd: string; encoding: 'utf8'; timeout: number }
  ): {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
}>('node:child_process');
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('node:fs');

const root = `${__dirname}/../..`;
const fixture = '__tests__/__fixtures__/biome-plugins/await-async-queries.ts';
const config = '__tests__/__fixtures__/biome-plugins/plugin.biome.json';

type Diagnostic = {
  category: string;
  location: { path: string; start: { line: number } };
};

const markedLines = (marker: string) =>
  fs
    .readFileSync(`${root}/${fixture}`, 'utf8')
    .split(/\r?\n/)
    .flatMap((line, index) =>
      line.endsWith(`// ${marker}`) ? [index + 1] : []
    );

describe('biome-plugins/await-async-queries.grit (U5)', () => {
  // このテストは plugin.biome.json でルールを確かめるので、リポジトリの biome.json がルールを __tests__ に
  // 適用していること（D52）は別に固定する（plugins のエントリを消すと通常の lint だけが効かなくなるため）
  it('is applied to __tests__ by the repository biome.json', () => {
    const repoConfig = JSON.parse(
      fs.readFileSync(`${root}/biome.json`, 'utf8')
    ) as {
      plugins?: unknown;
    };
    expect(repoConfig.plugins).toEqual([
      {
        path: './biome-plugins/await-async-queries.grit',
        includes: ['__tests__/**'],
      },
    ]);
  });

  it('reports exactly the lines marked `// detect` in the fixture', () => {
    // Biome の JS のラッパー（bin/biome。devDependency なのでルートの node_modules にある）を node で動かす
    // （OS ごとの .bin の違いを避ける）
    const biome = `${root}/node_modules/@biomejs/biome/bin/biome`;
    const run = spawnSync(
      process.execPath,
      [
        biome,
        'lint',
        `--config-path=${config}`,
        '--reporter=json',
        // JSON の reporter は 2.6.5 では切り詰めないが、実験的で変わりうるので念のため（既定の reporter は 20 件まで）
        '--max-diagnostics=none',
        fixture,
      ],
      { cwd: root, encoding: 'utf8', timeout: 30_000 }
    );
    if (run.error) {
      throw new Error(`biome failed to run: ${run.error.message}`);
    }
    // JSON の reporter は 1 行の JSON を stdout に出す（実験的という注意は stderr に出る）
    const json = run.stdout.split('\n').find((line) => line.startsWith('{'));
    if (json === undefined) {
      throw new Error(
        `biome did not print a JSON report:\n${run.stdout}\n${run.stderr}`
      );
    }
    const { diagnostics, summary } = JSON.parse(json) as {
      diagnostics: Diagnostic[];
      summary: { errors: number };
    };
    // 切り詰められていない（報告された件数と診断の件数が同じ）
    expect(summary.errors).toBe(diagnostics.length);
    expect(diagnostics.map((d) => d.category)).toEqual(
      diagnostics.map(() => 'plugin')
    );
    expect(diagnostics.every((d) => d.location.path === fixture)).toBe(true);

    const detected = markedLines('detect');
    const ok = markedLines('ok');
    expect(detected).toHaveLength(14);
    expect(ok).toHaveLength(12);
    expect(
      diagnostics.map((d) => d.location.start.line).sort((a, b) => a - b)
    ).toEqual(detected);
  });
});
