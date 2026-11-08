// パッケージの入口（src/index.ts）から出す値の確認。index.test.ts（1c の v1 の回帰テスト）は変えないので別ファイルにする。
// 内部の関数（resolve / evaluatePolicy / requestText / fetcher / detect / openStore など）を出していないことも確かめる
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
  StoreVersionError,
  type StoreVersionErrorCode,
  type VersionGetter,
  type VersionGetterContext,
} from '../src/index.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

describe('package entry', () => {
  it('exports only checkVersion (default and named), compareVersion and StoreVersionError as values', () => {
    expect(Object.keys(entry).sort()).toEqual([
      'StoreVersionError',
      'checkVersion',
      'compareVersion',
      'default',
    ]);
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
