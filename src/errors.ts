/**
 * {@link StoreVersionError} の `code`。
 *
 * - `LOCAL_VERSION_UNAVAILABLE`: アプリのバージョン / ID が取れない
 * - `TIMEOUT`: タイムアウト
 * - `NETWORK`: HTTP エラー / ネットワークエラー
 * - `NOT_FOUND`: ストアにアプリが無い
 * - `PARSE_FAILED`: Play Store の HTML からバージョンを抽出できない
 * - `INVALID_VERSION`: バージョンが比較できない（`Varies with device` など）
 * - `LATEST_VERSION_FAILED`: `getLatestVersion` が throw した / 不正な値を返した
 * - `MINIMUM_VERSION_FAILED`: `getMinimumVersion` が throw した / 不正な値を返した
 * - `STORE_URL_UNAVAILABLE`: ストアを開くときの iOS の lookup に失敗した
 */
export type StoreVersionErrorCode =
  | 'LOCAL_VERSION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'NOT_FOUND'
  | 'PARSE_FAILED'
  | 'INVALID_VERSION'
  | 'LATEST_VERSION_FAILED'
  | 'MINIMUM_VERSION_FAILED'
  | 'STORE_URL_UNAVAILABLE';

/**
 * このライブラリが `onError` などに渡すエラー。`code` で原因を区別できる。
 * 元になったエラーがあれば `cause` に入る。
 */
export class StoreVersionError extends Error {
  /** エラーの種類 */
  readonly code: StoreVersionErrorCode;

  constructor(
    code: StoreVersionErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'StoreVersionError';
    this.code = code;
    // 古い Hermes は Error の第 2 引数（cause）を無視するので、残らなければ自分で代入する
    if (options && 'cause' in options && !('cause' in this)) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}
