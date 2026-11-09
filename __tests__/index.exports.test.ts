// パッケージの入口（src/index.ts）から出す値の確認。index.test.ts（1c の v1 の回帰テスト）は変えないので別ファイルにする。
// 内部の関数（resolve / evaluatePolicy / requestText / fetcher / detect / openStore など）と、Provider の Context・
// defaultCountry を出していないことも確かめる。
// 3b: `react-native-store-version/texts/ja` の配布の形（package.json の exports / files と、古い Metro 用のパッケージ直下の
// texts/ja.js / ja.d.ts。D50 ⑤）もここで見る
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

// テストの tsconfig は types を ["jest"] にしていて @types/node を入れていないので、fs は jest.requireActual で型を指定して使う
declare const __dirname: string;
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('node:fs');
const readRootFile = (name: string) =>
  fs.readFileSync(`${__dirname}/../${name}`, 'utf8');

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

  it('is a default export only (the import of Texts.dc.html), and not part of the main entry', () => {
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
