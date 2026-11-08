// App Store（iTunes Lookup API）の取得。react-native を import しない（Node でも動かす）
import { StoreVersionError } from '../errors.ts';
import { requestText } from '../request.ts';

/** lookup の引き先。`bundleId`（v2 の既定）か、ストア URL から抜き出した数字の App ID（v1 互換の URL 方式） */
export type IOSLookupTarget = { bundleId: string } | { appId: string };

/** {@link lookupIOS} のオプション */
export type IOSLookupOptions = {
  /** 未指定ならタイムアウトしない（`requestText` の `timeoutMs`） */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** {@link lookupIOS} の結果 */
export type IOSLookupResult = {
  /** `results[0].version` */
  version: string;
  /** `results[0].trackViewUrl`（ストアを開く URL）。応答に無ければ null */
  storeUrl: string | null;
  /** `results[0].releaseNotes`。応答に無ければ undefined */
  releaseNotes?: string;
};

/**
 * App Store の URL（`https://apps.apple.com/jp/app/github/id1477376905` など）から数字の App ID を抜き出す。
 * v1 と同じ正規表現。取れなければ null
 */
export const appIdFromStoreUrl = (storeUrl: string): string | null =>
  storeUrl.match(/.+id([0-9]+)\??/)?.[1] ?? null;

/** lookup の URL（タイムスタンプを付ける前。in-flight の共有のキーにもなる） */
export const lookupUrl = (target: IOSLookupTarget, country: string): string => {
  const query =
    'bundleId' in target
      ? `bundleId=${encodeURIComponent(target.bundleId)}`
      : `id=${encodeURIComponent(target.appId)}`;
  return `https://itunes.apple.com/lookup?${query}&country=${encodeURIComponent(country)}`;
};

const describeTarget = (target: IOSLookupTarget): string =>
  'bundleId' in target
    ? `bundleId ${JSON.stringify(target.bundleId)}`
    : `appId ${JSON.stringify(target.appId)}`;

/**
 * iTunes Lookup API で App Store の版を引く。v1 と同じく URL にタイムスタンプを付け、`cache-control: no-cache` を送る（D40）。
 *
 * - 通信の失敗 / 200 以外 / JSON として読めない / `results[0].version` が文字列でない → `NETWORK`（D47）
 * - `results` が空（未リリース・その国で未配信）→ `NOT_FOUND`
 * - タイムアウト → `TIMEOUT`、`signal` の abort → `AbortError`
 */
export const lookupIOS = async (
  target: IOSLookupTarget,
  country: string,
  { timeoutMs, signal }: IOSLookupOptions = {}
): Promise<IOSLookupResult> => {
  const url = lookupUrl(target, country);
  const { status, body } = await requestText(url, {
    timeoutMs,
    signal,
    noCache: true,
  });
  if (status !== 200) {
    throw new StoreVersionError(
      'NETWORK',
      `iTunes Lookup responded with status ${status}`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (cause) {
    throw new StoreVersionError(
      'NETWORK',
      'iTunes Lookup returned a response that is not JSON',
      { cause }
    );
  }

  // v1 と同じく、results が無い・空なら「ストアに無い」（v1 は `appID(<id>) is not released.`）
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) {
    throw new StoreVersionError(
      'NOT_FOUND',
      `the app (${describeTarget(target)}) is not found on the App Store (${country})`
    );
  }

  const app = results[0] as {
    version?: unknown;
    trackViewUrl?: unknown;
    releaseNotes?: unknown;
  } | null;
  if (typeof app?.version !== 'string') {
    throw new StoreVersionError(
      'NETWORK',
      'iTunes Lookup returned a result without a version'
    );
  }

  const result: IOSLookupResult = {
    version: app.version,
    storeUrl:
      typeof app.trackViewUrl === 'string' && app.trackViewUrl !== ''
        ? app.trackViewUrl
        : null,
  };
  if (typeof app.releaseNotes === 'string') {
    result.releaseNotes = app.releaseNotes;
  }
  return result;
};

/**
 * ストアを開く URL の取得結果。reject しない形にしてある（判定とは別に後から受け取るので、
 * 誰も待っていなくても unhandled rejection にならないように）
 */
export type StoreUrlResult =
  | { storeUrl: string; error: null }
  | { storeUrl: null; error: StoreVersionError };

/** lookup に失敗して URL を取れなかったときの `STORE_URL_UNAVAILABLE`。cause に lookup のエラー */
export const storeUrlUnavailable = (
  cause: unknown
): { storeUrl: null; error: StoreVersionError } => ({
  storeUrl: null,
  error: new StoreVersionError(
    'STORE_URL_UNAVAILABLE',
    'could not get the App Store URL',
    { cause }
  ),
});

/** lookup の `storeUrl` から {@link StoreUrlResult} を作る（trackViewUrl が無ければ `STORE_URL_UNAVAILABLE`） */
export const toStoreUrlResult = (storeUrl: string | null): StoreUrlResult =>
  storeUrl === null
    ? {
        storeUrl: null,
        error: new StoreVersionError(
          'STORE_URL_UNAVAILABLE',
          'iTunes Lookup returned no trackViewUrl'
        ),
      }
    : { storeUrl, error: null };

/**
 * bundleId で lookup して、ストアを開く URL（`trackViewUrl`）だけを取る。`version` / `releaseNotes` は使わない
 * （`getLatestVersion` の値と食い違いうるため。4.5）。失敗は reject せず `STORE_URL_UNAVAILABLE`（cause に lookup のエラー）で返す
 */
export const lookupStoreUrl = (
  bundleId: string,
  country: string,
  options: IOSLookupOptions = {}
): Promise<StoreUrlResult> =>
  lookupIOS({ bundleId }, country, options).then(
    (result) => toStoreUrlResult(result.storeUrl),
    storeUrlUnavailable
  );
