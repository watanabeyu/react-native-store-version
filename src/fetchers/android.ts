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

/** Play Store のページから版と一緒に取れる値（{@link extractPlayRelease}）。取れなかったものは undefined */
export type PlayRelease = {
  /** 「新機能」の本文（改行は `\n`）。「新機能」が無い・空なら undefined */
  releaseNotes?: string;
  /** 今の版の公開日（ISO 8601 の UTC で秒まで。`2026-11-05T22:49:03Z`） */
  releaseDate?: string;
};

/** {@link fetchAndroidVersion} の結果 */
export type AndroidFetchResult = PlayRelease & {
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

// 版の位置の 3 つの形（版あり `[[["1.283.0"]],[[[37]],[[[26,"8.0"]]]]]` / Varies `[[null,[]],[[[28,"9"]],[null,[]]]]` /
// Varies で最低 OS の表示も無い `[[null,[]],[[[36]],[null,[]]]]`）の、すぐ後ろに続く
// `,null,null,null,<リリースノート>,[["<表示用の日付>",[<秒>,<ナノ秒>]]]` を取る。版の位置に錨を下ろすのは、
// ページのほかの場所にも同じ形の日付の配列があるため。表示用の日付は言語とタイムゾーンで変わるので使わない。
// 版ありの形は VERSION_SLOT と同じにする（広げると、版は別の場所から取り、リリースノートと公開日だけこの位置から取る、
// という食い違いが起きうる）。3 つの形のほかの組み合わせは受けない
const RELEASE_SLOT = String.raw`(?:\[\[\["[^"\\]{1,64}"\]\],\[\[\[\d+\]\],\[\[\[\d+,"[^"\\]{0,16}"\]\]\]\]\]|\[\[null,\[\]\],\[\[\[\d+,"[^"\\]{0,16}"\]\],\[null,\[\]\]\]\]|\[\[null,\[\]\],\[\[\[\d+\]\],\[null,\[\]\]\]\])`;
const RELEASE_TAIL = String.raw`,null,null,null,(?:null|\[null,\[null,("(?:[^"\\]|\\.)*")\]\]),\[\[("(?:[^"\\]|\\.)*"),\[(\d+),(\d+)\]\]\]`;
/**
 * リリースノートと公開日。キャプチャは 1 = リリースノート（JSON の文字列。`null` なら undefined）、
 * 2 = 表示用の日付（JSON の文字列。使わない）、3 = 公開日の Unix 時刻の秒、4 = そのナノ秒（使わない）
 */
const RELEASE = new RegExp(RELEASE_SLOT + RELEASE_TAIL);

/**
 * 抽出に使うパターン。実ページの fixture にどのパターンが当たるか（当たらないか）をテストで確かめるために出している
 * （パッケージの入口からは export しない）
 */
export const PLAY_VERSION_PATTERNS: Readonly<{
  versionSlot: RegExp;
  emptyVersionSlot: RegExp;
  v1: RegExp;
  release: RegExp;
}> = Object.freeze({
  versionSlot: VERSION_SLOT,
  emptyVersionSlot: EMPTY_VERSION_SLOT,
  v1: V1_VERSION,
  release: RELEASE,
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

/** リリースノートの改行（`<br>` / `<br/>` / `<br />`）。ほかのタグや HTML の実体参照は直さない */
const LINE_BREAK = /<br\s*\/?>/g;

/**
 * Play Store の HTML から、版と一緒に表示されるリリースノートと公開日を取り出す（{@link extractPlayVersion} とは別。
 * パッケージの入口からは export しない）。
 *
 * - `releaseNotes`: JSON の文字列として読み、`<br>` を `\n` に直す。`null` か空文字なら undefined
 * - `releaseDate`: Unix 時刻の秒から、ISO 8601 の UTC で秒まで（`2026-11-05T22:49:03Z`）
 *
 * 取れなくても投げない（版の取得を失敗にしない）。パターンに当たらない・値の形がおかしいものは undefined にし、
 * 値のあるものだけをキーに入れる。正規表現の実行そのものが投げた（エンジンの上限など）ときも、何も取れなかった扱いにする
 */
export const extractPlayRelease = (html: string): PlayRelease => {
  const release: PlayRelease = {};
  let match: RegExpMatchArray | null;
  try {
    match = html.match(RELEASE);
  } catch {
    return release;
  }
  if (match === null) {
    return release;
  }
  const [, notes, , seconds] = match;
  if (notes !== undefined) {
    try {
      const text = (JSON.parse(notes) as string).replace(LINE_BREAK, '\n');
      if (text !== '') {
        release.releaseNotes = text;
      }
    } catch {
      // 読めない文字列（不正なエスケープなど）はリリースノートだけを諦める
    }
  }
  const date = new Date(Number(seconds) * 1000);
  // 大きすぎる秒は Invalid Date になり、toISOString が投げる
  if (!Number.isNaN(date.getTime())) {
    release.releaseDate = date.toISOString().replace(/\.\d+Z$/, 'Z');
  }
  return release;
};

// fetchAndroidVersion が投げた INVALID_VERSION（版が比較できない）に添える、同じページから取れたリリースノートと公開日。
// エラーのオブジェクト自体には何も足さない（StoreVersionError の形を変えないため）。エラーと一緒に捨てられるので、
// キャッシュにはならない
const playRelease = new WeakMap<object, PlayRelease>();

/**
 * {@link fetchAndroidVersion} が投げた `INVALID_VERSION`（Varies with device / 比較できない版）に添えた、
 * 同じページから取れたリリースノートと公開日（{@link extractPlayRelease} の結果）。添えていないエラーやほかの値なら空のオブジェクト。
 * 版が比較できなくても最低バージョンで force にするときに渡すため（パッケージの入口からは export しない）
 */
export const playExtrasOf = (error: unknown): PlayRelease =>
  (typeof error === 'object' && error !== null && playRelease.get(error)) || {};

/**
 * Play Store のアプリの詳細ページを取得して版を返す。
 *
 * - 404 → `NOT_FOUND`（Google Play に無い: 未公開・取り下げなど。iOS の results が空と同じ扱い。本文の読み込みに失敗しても同じ）
 * - 通信の失敗 / 200・404 以外 → `NETWORK`
 * - 版の位置が空 / 比較できない版 → `INVALID_VERSION`、抽出できない → `PARSE_FAILED`（{@link extractPlayVersion}）。
 *   `INVALID_VERSION` には、同じページから取れたリリースノートと公開日を添える（{@link playExtrasOf} で読む）
 * - タイムアウト → `TIMEOUT`、`signal` の abort → `AbortError`
 *
 * 版が取れたときは、リリースノートと公開日（{@link extractPlayRelease}。取れたものだけ）も返す。
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
  let version: string;
  try {
    version = extractPlayVersion(body);
  } catch (error) {
    // 版が比較できなくても、最低バージョンで force にするときに同じページの値を渡せるように添える。
    // PARSE_FAILED（ページの形が変わった）には添えない
    if (
      error instanceof StoreVersionError &&
      error.code === 'INVALID_VERSION'
    ) {
      playRelease.set(error, extractPlayRelease(body));
    }
    throw error;
  }
  return { version, storeUrl: url, ...extractPlayRelease(body) };
};
