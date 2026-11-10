// Google Play（アプリの詳細ページの HTML）の取得。react-native を import しない（Node でも動かす）
import { assertValidVersion } from '../compare.ts';
import { StoreVersionError } from '../errors.ts';
import { failedResponseStatusOf, requestText } from '../request.ts';

/** 取得先。`packageName`（v2 の既定）か、ストア URL そのもの（v1 互換。checkVersion が使う） */
export type AndroidTarget = { packageName: string } | { storeUrl: string };

/** {@link fetchAndroidVersion} のオプション */
export type AndroidFetchOptions = {
  /** 未指定ならタイムアウトしない（`requestText` の `timeoutMs`） */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** {@link fetchAndroidVersion} の結果 */
export type AndroidFetchResult = {
  /** 比較できることを確かめた版 */
  version: string;
  /** 取得したページの URL */
  storeUrl: string;
};

/** package name からアプリの詳細ページの URL を組み立てる。クエリ（`hl` / `gl`）は付けない */
export const playStoreUrl = (packageName: string): string =>
  `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;

// 実ページ（__tests__/__fixtures__/store/）に対して確かめたパターン。
// 版は `,null,null,null,[[["<versionName>"]],[[[N]],[[[M,"<最低 OS>"]]]]]` に入っている。
// `ds:N` の番号や hash は取得ごとに変わるので錨にしない。版より前にレビューの要素（古い版を持つ）が来ることがあるので、
// 数字だけを拾うパターンを先に試すと古い版を返してしまう
/** 1. 版の位置の文字列を取る（構造に錨を下ろす。数字でない versionName も取れる） */
const VERSION_SLOT =
  /\[\[\["([^"\\]{1,64})"\]\],\[\[\[\d+\]\],\[\[\[\d+,"[^"\\]{0,16}"\]\]\]\]\]/;
/**
 * 版の位置が空（`[null,[]]`。Google Play の「Varies with device」。ページにその文言は無い）。
 * 版の位置の前置き（`,null,null,null,`）と空の版（`[[null,[]],`）だけを錨にする。後ろ（最低 OS など）まで決め打ちにすると、
 * 少し違う形の Varies のページで当たらず、v1 のパターンが別の場所（レビューの古い版など）を拾ってしまうため
 */
const EMPTY_VERSION_SLOT = /,null,null,null,\[\[null,\[\]\],/;
/** 2. v1 のパターン（数字とドットだけの版） */
const V1_VERSION = /\[\[\[['"]((\d+\.)+\d+)['"]\]\],/;

/**
 * 抽出に使うパターン。実ページの fixture にどのパターンが当たるか（当たらないか）をテストで確かめるために出している
 * （パッケージの入口からは export しない）
 */
export const PLAY_VERSION_PATTERNS: Readonly<{
  versionSlot: RegExp;
  emptyVersionSlot: RegExp;
  v1: RegExp;
}> = Object.freeze({
  versionSlot: VERSION_SLOT,
  emptyVersionSlot: EMPTY_VERSION_SLOT,
  v1: V1_VERSION,
});

/**
 * Play Store の HTML から版を取り出す。
 *
 * 1. 版の位置の文字列（構造に錨を下ろしたパターン）
 * 2. 版の位置が空なら `INVALID_VERSION`（Varies with device）
 * 3. v1 のパターン（数字とドットだけ）
 * 4. どれにも当たらなければ `PARSE_FAILED`
 *
 * 取れた文字列が比較できない（`50616-r-2026-11-03` など）なら `INVALID_VERSION`
 */
export const extractPlayVersion = (html: string): string => {
  let version = html.match(VERSION_SLOT)?.[1];
  if (version === undefined) {
    // 版の位置が空だと分かるなら、ほかの場所の数字を拾わずに Varies として扱う
    if (EMPTY_VERSION_SLOT.test(html)) {
      throw new StoreVersionError(
        'INVALID_VERSION',
        'the Play Store page has no version for this app (Varies with device)'
      );
    }
    version = html.match(V1_VERSION)?.[1];
  }
  if (version === undefined) {
    throw new StoreVersionError(
      'PARSE_FAILED',
      'could not find the version in the Play Store page'
    );
  }
  assertValidVersion(version, 'remote');
  return version;
};

/**
 * Play Store のアプリの詳細ページを取得して版を返す。
 *
 * - 404 → `NOT_FOUND`（Google Play に無い: 未公開・取り下げなど。iOS の results が空と同じ扱い。本文の読み込みに失敗しても同じ）
 * - 通信の失敗 / 200・404 以外 → `NETWORK`
 * - 版の位置が空 / 比較できない版 → `INVALID_VERSION`、抽出できない → `PARSE_FAILED`（{@link extractPlayVersion}）
 * - タイムアウト → `TIMEOUT`、`signal` の abort → `AbortError`
 *
 * `{ storeUrl }` は URL をそのまま取得する（検証も書き換えもしない。v1 互換の入口で、URL の検証は呼び出し側で行う）
 */
export const fetchAndroidVersion = async (
  target: AndroidTarget,
  { timeoutMs, signal }: AndroidFetchOptions = {}
): Promise<AndroidFetchResult> => {
  const url =
    'packageName' in target
      ? playStoreUrl(target.packageName)
      : target.storeUrl;
  const notFound = () =>
    new StoreVersionError(
      'NOT_FOUND',
      'packageName' in target
        ? `the app (packageName "${target.packageName}") is not found on Google Play`
        : `the app (${url}) is not found on Google Play`
    );
  let response: { status: number; body: string };
  try {
    response = await requestText(url, { timeoutMs, signal });
  } catch (error) {
    // 404 の本文の読み込みに失敗しても、status が 404 なら NOT_FOUND（本文の読み方で code が変わらないように）
    if (failedResponseStatusOf(error) === 404) {
      throw notFound();
    }
    throw error;
  }
  const { status, body } = response;
  if (status === 404) {
    throw notFound();
  }
  if (status !== 200) {
    throw new StoreVersionError(
      'NETWORK',
      `the Play Store responded with status ${status}`
    );
  }
  return { version: extractPlayVersion(body), storeUrl: url };
};
