// 開発者が渡す取得元（getLatestVersion / getMinimumVersion。4.6）の呼び出し。react-native を import しない
import { StoreVersionError } from '../errors.ts';

/** {@link VersionGetter} が受け取る値 */
export type VersionGetterContext = {
  /** 判定しているプラットフォーム */
  platform: 'ios' | 'android';
  /** タイムアウト時（と判定の取り消し時）に abort される。fetch に渡せば通信も止まる */
  signal: AbortSignal;
};

/**
 * バージョン文字列を 1 つ返す async 関数（`getLatestVersion` / `getMinimumVersion`）。
 * Firebase Remote Config や自前の JSON などから返す想定。失敗したら throw すればよい。
 * `signal` を fetch に渡さないと、タイムアウト後も通信は続く（判定には使われない）
 */
export type VersionGetter = (
  ctx: VersionGetterContext
) => Promise<string | null | undefined>;

const describe = (value: unknown): string =>
  value === null ? 'null' : `(${typeof value})`;

/**
 * `getLatestVersion` を呼ぶ。throw した / 空文字・null・undefined / 文字列でない値なら `LATEST_VERSION_FAILED`
 * （throw したときは cause に元のエラー）。比較できない文字列はそのまま返す（判定で `INVALID_VERSION` になる）
 */
export const callLatestVersion = async (
  getter: VersionGetter,
  ctx: VersionGetterContext
): Promise<string> => {
  let value: unknown;
  try {
    value = await getter(ctx);
  } catch (cause) {
    throw new StoreVersionError(
      'LATEST_VERSION_FAILED',
      'getLatestVersion threw',
      { cause }
    );
  }
  if (typeof value !== 'string' || value === '') {
    throw new StoreVersionError(
      'LATEST_VERSION_FAILED',
      `getLatestVersion returned ${value === '' ? 'an empty string' : `an invalid value: ${describe(value)}`}`
    );
  }
  return value;
};

/**
 * `getMinimumVersion` を呼ぶ。空文字 / null / undefined は「指定なし」で null を返す。
 * throw した / 文字列でない値なら `MINIMUM_VERSION_FAILED`（throw したときは cause に元のエラー）。
 * 比較できない文字列はそのまま返す（判定で最低バージョンだけを飛ばす。D46 ②）
 */
export const callMinimumVersion = async (
  getter: VersionGetter,
  ctx: VersionGetterContext
): Promise<string | null> => {
  let value: unknown;
  try {
    value = await getter(ctx);
  } catch (cause) {
    throw new StoreVersionError(
      'MINIMUM_VERSION_FAILED',
      'getMinimumVersion threw',
      { cause }
    );
  }
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new StoreVersionError(
      'MINIMUM_VERSION_FAILED',
      `getMinimumVersion returned an invalid value: ${describe(value)}`
    );
  }
  return value;
};
