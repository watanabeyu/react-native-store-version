// パッケージの入口（src/index.ts）から出す値の確認。index.test.ts（1c の v1 の回帰テスト）は変えないので別ファイルにする。
// 内部の関数（resolve / evaluatePolicy / requestText / fetcher / detect / openStore など）と、Provider の Context・
// defaultCountry を出していないことも確かめる。
// 3b: `react-native-store-version/texts/ja` の配布の形（package.json の exports / files と、古い Metro 用のパッケージ直下の
// texts/ja.js / ja.d.ts。D50 ⑤）もここで見る
// 4a: CLI（src/cli → dist/cli。Node 専用）が bin だけから使え、アプリのバンドルに入らない（exports と入口の import から辿れない）ことも見る
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import * as entry from '../src/index.ts';
import checkVersion, {
  type Action,
  type CheckVersionParams,
  type CheckVersionResponse,
  type CompareDetail,
  type CompareResult,
  compareVersion,
  type DiffType,
  type Policy,
  type StoreVersionCheckResult,
  type StoreVersionComponents,
  StoreVersionError,
  type StoreVersionErrorCode,
  type StoreVersionForceProps,
  type StoreVersionForceTexts,
  StoreVersionProvider,
  type StoreVersionProviderProps,
  type StoreVersionResolvedTexts,
  type StoreVersionStatus,
  type StoreVersionTexts,
  type StoreVersionWarningProps,
  type StoreVersionWarningTexts,
  type UseStoreVersionResult,
  useStoreVersion,
  type VersionGetter,
  type VersionGetterContext,
} from '../src/index.ts';
import { StoreVersionProvider as ProviderModule } from '../src/react/StoreVersionProvider.tsx';
import { useStoreVersion as hookModule } from '../src/react/useStoreVersion.ts';
import ja from '../src/texts/ja.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

const rootDir = join(__dirname, '..');
const readRootFile = (name: string) =>
  readFileSync(join(rootDir, name), 'utf8');

// components の型の確認用（コンポーネントはモジュールの直下で定義する。Biome の noNestedComponentDefinitions）
const Force = (_: StoreVersionForceProps) => null;
const Warning = (_: StoreVersionWarningProps) => null;

describe('package entry', () => {
  it('exports only checkVersion (default and named), compareVersion, StoreVersionError, StoreVersionProvider and useStoreVersion as values', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'StoreVersionError',
      'StoreVersionProvider',
      'checkVersion',
      'compareVersion',
      'default',
      'useStoreVersion',
    ]);
    expect(StoreVersionProvider).toBe(ProviderModule);
    expect(useStoreVersion).toBe(hookModule);
    expect(entry.default).toBe(entry.checkVersion);
    expect(checkVersion).toBe(entry.checkVersion);
    expect(compareVersion('1.0.0', '1.1.0')).toBe('new');
    const error = new StoreVersionError('NETWORK', 'x');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NETWORK');
  });

  it('exports the public types', () => {
    // 型が入口から使えることを tsc（pnpm typecheck）で確かめる。値は形の確認だけ
    const params: CheckVersionParams = { country: 'us', timeoutMs: 1000 };
    const response: CheckVersionResponse = {
      local: '1.0.0',
      remote: '1.1.0',
      result: 'new' satisfies CompareResult,
      detail: 'remote > local' satisfies CompareDetail,
    };
    const action: Action = 'warning';
    const diff: DiffType = 'minor';
    const policy: Policy = { [diff]: action };
    const code: StoreVersionErrorCode = 'TIMEOUT';
    const getter: VersionGetter = async (ctx: VersionGetterContext) =>
      ctx.platform === 'ios' ? '1.0.0' : null;
    const status: StoreVersionStatus = 'ready';
    const checked: StoreVersionCheckResult = {
      result: 'new',
      detail: 'remote > local',
      action,
      diff,
      local: '1.0.0',
      remote: '1.1.0',
    };
    const forceTexts: StoreVersionForceTexts = {
      title: 't',
      message: 'm',
      update: 'u',
    };
    const warningTexts: StoreVersionWarningTexts = {
      ...forceTexts,
      later: 'l',
    };
    const texts: StoreVersionTexts = { force: { title: 'x' }, warning: {} };
    // ja プリセットはすべてのキーが埋まった形で、そのまま texts に渡せる
    const preset: StoreVersionResolvedTexts = ja;
    const jaTexts: StoreVersionTexts = preset;
    const components: StoreVersionComponents = { Force, Warning };
    const props: StoreVersionProviderProps = {
      policy,
      texts,
      components,
      getLatestVersion: getter,
      onResult: (r: StoreVersionCheckResult) => r,
    };
    const hookResult: Pick<UseStoreVersionResult, 'status' | 'action'> = {
      status,
      action,
    };
    expect([
      checked.action,
      warningTexts.later,
      props.texts,
      hookResult,
      jaTexts.warning?.later,
    ]).toEqual([
      'warning',
      'l',
      { force: { title: 'x' }, warning: {} },
      { status: 'ready', action: 'warning' },
      'あとで',
    ]);
    expect([params, response, policy, code, typeof getter]).toEqual([
      { country: 'us', timeoutMs: 1000 },
      {
        local: '1.0.0',
        remote: '1.1.0',
        result: 'new',
        detail: 'remote > local',
      },
      { minor: 'warning' },
      'TIMEOUT',
      'function',
    ]);
  });
});

describe('texts/ja entry (D50 ⑤)', () => {
  const pkg = JSON.parse(readRootFile('package.json')) as {
    exports: Record<string, unknown>;
    files: string[];
  };

  it('is a default export only (the import of the texts mock), and not part of the main entry', () => {
    expect(Object.keys(ja).sort()).toEqual(['force', 'warning']);
    expect(Object.keys(entry)).not.toContain('ja');
  });

  it('package.json: exports ./texts/ja (types / default) and ships texts/', () => {
    expect(pkg.exports['./texts/ja']).toEqual({
      types: './dist/texts/ja.d.ts',
      default: './dist/texts/ja.js',
    });
    expect(pkg.files).toContain('texts');
    expect(pkg.files).toContain('dist');
  });

  it('texts/ja.js and texts/ja.d.ts at the package root re-export dist/texts/ja (for Metro without exports support)', () => {
    const js = readRootFile('texts/ja.js');
    const dts = readRootFile('texts/ja.d.ts');
    for (const file of [js, dts]) {
      // 再 export だけ（実装を持たない）
      expect(file).toMatch(
        /^export \{ default \} from '\.\.\/dist\/texts\/ja\.js';$/m
      );
      expect(
        file.split('\n').filter((line) => !line.startsWith('//') && line !== '')
      ).toEqual(["export { default } from '../dist/texts/ja.js';"]);
    }
  });
});

describe('CLI (src/cli → dist/cli) is not reachable from the app entries (4a)', () => {
  const pkg = JSON.parse(readRootFile('package.json')) as {
    main: string;
    exports: Record<string, string | { types: string; default: string }>;
    bin: Record<string, string>;
  };

  it('package.json: the CLI is only the bin, and the exports are . / ./texts/ja / ./package.json', () => {
    expect(pkg.bin).toEqual({
      'react-native-store-version': './dist/cli/index.js',
    });
    expect(Object.keys(pkg.exports)).toEqual([
      '.',
      './texts/ja',
      './package.json',
    ]);
    expect(JSON.stringify(pkg.exports)).not.toContain('cli');
    expect(pkg.main).toBe('./dist/index.js');
  });

  // 入口（main / exports の default。dist では、パッケージ直下の texts/ja.js も）から相対の import / export / import() / require を辿る。
  // パッケージ名の import（react-native など）は辿らない。コメントの中の `import` は拾わないよう、先に消す
  const SPECIFIER =
    /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*([^)]*?)\s*\)|\brequire\(\s*([^)]*?)\s*\)/g;

  const specifiersOf = (file: string): string[] => {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    return [...code.matchAll(SPECIFIER)].map((m) => {
      const literal = m[1] ?? m[2];
      if (literal !== undefined) {
        return literal;
      }
      // import() / require() は文字列リテラルだけ（式だと辿れない）
      const arg = (m[3] ?? m[4]).match(/^['"]([^'"]+)['"]$/);
      if (!arg) {
        throw new Error(`${file}: non-literal ${m[0]}`);
      }
      return arg[1];
    });
  };

  const reachable = (entries: string[]): string[] => {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) {
        continue;
      }
      if (!existsSync(file)) {
        throw new Error(`${relative(rootDir, file)} does not exist`);
      }
      seen.add(file);
      for (const specifier of specifiersOf(file)) {
        if (specifier.startsWith('.')) {
          queue.push(resolve(dirname(file), specifier));
        }
      }
    }
    return [...seen].map((file) => relative(rootDir, file)).sort();
  };

  const distEntries = [
    pkg.main,
    ...Object.values(pkg.exports).flatMap((target) =>
      typeof target === 'string' ? [] : [target.default]
    ),
  ];

  const expectNoCli = (files: string[], tree: 'src' | 'dist') => {
    // 辿れていること（入口と、ライブラリ本体のファイル）
    expect(files).toContain(`${tree}/index.${tree === 'src' ? 'ts' : 'js'}`);
    expect(files).toContain(`${tree}/request.${tree === 'src' ? 'ts' : 'js'}`);
    expect(files).toContain(`${tree}/texts/ja.${tree === 'src' ? 'ts' : 'js'}`);
    expect(files.filter((file) => file.startsWith(`${tree}/cli/`))).toEqual([]);
  };

  it('src: the sources of the entries do not import src/cli', () => {
    // dist の入口に対応する src（dist/x.js → src/x.ts か src/x.tsx）
    const entries = distEntries.map((entry) => {
      const base = join(rootDir, entry.replace(/^\.\/dist\//, 'src/'));
      const ts = base.replace(/\.js$/, '.ts');
      return existsSync(ts) ? ts : `${ts}x`;
    });
    expectNoCli(reachable(entries), 'src');
  });

  // CI の test ジョブはビルドしないので dist が無い（そのときは上の src の確認だけになる。src と dist は同じ import の形）
  const built = existsSync(join(rootDir, 'dist/index.js'));
  (built ? it : it.skip)(
    'dist: the entries (and texts/ja.js at the package root) do not import dist/cli',
    () => {
      const files = reachable(
        [...distEntries, './texts/ja.js'].map((entry) => join(rootDir, entry))
      );
      expectNoCli(files, 'dist');
      expect(files).toContain('texts/ja.js');
    }
  );

  // CLI のビルド（tsconfig.build.cli.json。types: ["node"]）は .d.ts を出さない。出すと、共有するファイル（fetchers / request など）の
  // .d.ts が Node の型ありで上書きされ、利用者の型チェックに Node の型が要るようになりうる
  (built ? it : it.skip)(
    'dist: the .d.ts files do not refer to the Node types, and dist/cli has no .d.ts',
    () => {
      const files = (
        readdirSync(join(rootDir, 'dist'), {
          recursive: true,
        }) as string[]
      ).map((file) => file.split(sep).join('/'));
      const dts = files.filter((file) => file.endsWith('.d.ts'));
      expect(dts).toContain('index.d.ts');
      expect(dts).toContain('fetchers/ios.d.ts');
      expect(
        files.filter(
          (file) => file.startsWith('cli/') && /\.d\.ts(\.map)?$/.test(file)
        )
      ).toEqual([]);
      expect(files).toContain('cli/index.js');
      for (const file of dts) {
        const text = readFileSync(join(rootDir, 'dist', file), 'utf8');
        expect([file, text.includes('reference types="node"')]).toEqual([
          file,
          false,
        ]);
        expect([file, text.includes('NodeJS.')]).toEqual([file, false]);
      }
    }
  );
});
