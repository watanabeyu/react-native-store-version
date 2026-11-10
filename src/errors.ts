/**
 * {@link StoreVersionError} の `code`。
 *
 * - `LOCAL_VERSION_UNAVAILABLE`: アプリのバージョン / ID が取れない
 * - `TIMEOUT`: タイムアウト
 * - `NETWORK`: HTTP エラー / ネットワークエラー / iTunes Lookup の応答が JSON として読めない・`results[0].version` が文字列でない
 * - `NOT_FOUND`: ストアにアプリが無い（iTunes Lookup の results が空、Google Play の 404）
 * - `PARSE_FAILED`: Play Store の HTML からバージョンを抽出できない
 * - `INVALID_VERSION`: バージョンが比較できない（`Varies with device` など）
 * - `LATEST_VERSION_FAILED`: `getLatestVersion` が throw した / 不正な値を返した
 * - `MINIMUM_VERSION_FAILED`: `getMinimumVersion` が throw した / 不正な値を返した / タイムアウトした（cause は `TIMEOUT`）
 * - `STORE_URL_UNAVAILABLE`: ストアの URL を取れない / 開けない。iOS の URL の lookup の失敗（起動時・ストアを開くとき。
 *   `trackViewUrl` が無い場合も）と、ストアを開く `Linking.openURL` 自体の失敗（Android は `market://` と https の両方が失敗したとき）。
 *   cause に元のエラー。判定の `status` / `error` は変えない
 * - `POLICY_FAILED`: `policy` の関数が throw した / 不正な値を返した（`'force' | 'warning' | 'none'` 以外）
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
  | 'STORE_URL_UNAVAILABLE'
  | 'POLICY_FAILED';

// cause の型だけを宣言マージで足す。クラスのフィールドにすると useDefineForClassFields で
// super() が入れた cause を undefined で上書きしてしまう
export interface StoreVersionError {
  /** 元になったエラー（あれば） */
  readonly cause?: unknown;
}

/**
 * このライブラリが `onError` などに渡すエラー。`code` で原因を区別できる。
 * 元になったエラーがあれば `cause` に入る。
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: cause の型だけを足す意図的な宣言マージ（上の interface）
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
