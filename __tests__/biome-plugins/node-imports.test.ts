/**
 * @jest-environment node
 */
// biome.json の overrides の noRestrictedImports（src のうち src/cli 以外で `node:*` を止める）の回帰テスト。
// await-async-queries.test.ts と同じく fixture を Biome で lint し、診断が出る行が fixture の `// detect` の行と一致する
// （`// ok` の行には出ない）ことを確かめる。`node:*` だけでは `node:fs/promises` に当たらない（パターンに `node:*/*` が要る）ので、
// パターンを削ったり Biome を上げて効かなくなったりしたときに気づくため。
//
// override は includes のパスで効くので、リポジトリの biome.json の override をそのまま写した設定を一時ディレクトリに作り、
// fixture の写しを src/（RN 側）・src/cli/・__tests__/ に置いて lint する（fixture は通常の lint の対象外で、
// リポジトリの src に置くわけにもいかないため）。設定の写しは override 以外のルールを切る（preset: none）
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const fixture = join(
  root,
  '__tests__/__fixtures__/biome-plugins/node-imports.ts'
);

type Override = { includes?: string[]; linter?: unknown };

const repoOverride = (): Override => {
  const config = JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8')) as {
    overrides?: Override[];
  };
  const found = (config.overrides ?? []).filter((o) =>
    JSON.stringify(o.linter ?? {}).includes('noRestrictedImports')
  );
  if (found.length !== 1) {
    throw new Error(
      `expected one override with noRestrictedImports, got ${found.length}`
    );
  }
  return found[0];
};

const markedLines = (marker: string) =>
  readFileSync(fixture, 'utf8')
    .split(/\r?\n/)
    .flatMap((line, index) =>
      line.endsWith(`// ${marker}`) ? [index + 1] : []
    );

type Diagnostic = {
  category: string;
  location: { path: string; start: { line: number } };
};

describe('biome.json: node:* is restricted outside src/cli', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rnsv-biome-'));
    writeFileSync(
      join(dir, 'biome.json'),
      JSON.stringify({
        root: true,
        vcs: { enabled: false },
        files: { includes: ['**'] },
        formatter: { enabled: false },
        assist: { enabled: false },
        linter: { enabled: true, rules: { preset: 'none' } },
        overrides: [repoOverride()],
      })
    );
    for (const sub of ['src', 'src/cli', '__tests__']) {
      mkdirSync(join(dir, sub), { recursive: true });
      copyFileSync(fixture, join(dir, sub, 'node-imports.ts'));
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps src/vendor out of lint and format (the vendor override comes after this one)', () => {
    // この override（src/** に linter の設定を持つ）を後に置くと、src/vendor でも lint と --write の修正が戻ってしまう
    const { overrides = [] } = JSON.parse(
      readFileSync(join(root, 'biome.json'), 'utf8')
    ) as { overrides?: Override[] };
    expect(overrides.at(-1)).toEqual({
      includes: ['src/vendor/**'],
      formatter: { enabled: false },
      linter: { enabled: false },
      assist: { enabled: false },
    });
  });

  it('applies to src/** except src/cli/** in the repository biome.json', () => {
    expect(repoOverride()).toEqual({
      includes: ['src/**', '!src/cli/**'],
      linter: {
        rules: {
          style: {
            noRestrictedImports: {
              level: 'error',
              options: {
                patterns: [
                  {
                    group: ['node:*', 'node:*/*'],
                    message: 'Node の標準モジュールは src/cli だけで使う',
                  },
                ],
              },
            },
          },
        },
      },
    });
  });

  it('reports exactly the lines marked `// detect` in src/, and nothing in src/cli/ or __tests__/', () => {
    const biome = join(root, 'node_modules/@biomejs/biome/bin/biome');
    const run = spawnSync(
      process.execPath,
      [
        biome,
        'lint',
        '--reporter=json',
        '--max-diagnostics=none',
        'src/node-imports.ts',
        'src/cli/node-imports.ts',
        '__tests__/node-imports.ts',
      ],
      { cwd: dir, encoding: 'utf8', timeout: 30_000 }
    );
    if (run.error) {
      throw new Error(`biome failed to run: ${run.error.message}`);
    }
    const json = run.stdout.split('\n').find((line) => line.startsWith('{'));
    if (json === undefined) {
      throw new Error(
        `biome did not print a JSON report:\n${run.stdout}\n${run.stderr}`
      );
    }
    const { diagnostics, summary } = JSON.parse(json) as {
      diagnostics: Diagnostic[];
      summary: { errors: number; unchanged: number; changed: number };
    };
    // 3 つとも lint された（パスの指定の誤りで飛ばされていない）
    expect(summary.unchanged + summary.changed).toBe(3);
    expect(summary.errors).toBe(diagnostics.length);
    expect(diagnostics.map((d) => d.category)).toEqual(
      diagnostics.map(() => 'lint/style/noRestrictedImports')
    );
    expect(diagnostics.map((d) => d.location.path)).toEqual(
      diagnostics.map(() => 'src/node-imports.ts')
    );

    const detected = markedLines('detect');
    expect(detected).toHaveLength(7);
    expect(markedLines('ok')).toHaveLength(4);
    expect(
      diagnostics.map((d) => d.location.start.line).sort((a, b) => a - b)
    ).toEqual(detected);
  });
});
