// v1 互換の checkVersion。取得の層（request / fetcher / detect）の上に載せ替えたもの。
// 同じ入力（v1 で必須だった引数をすべて渡した場合）なら v1 と同じ戻り値・エラーメッセージを返す。
// 例外は compare-versions 6.1.1 の比較の差と、Android の版の抽出が v2 の抽出（構造に錨を下ろしたパターン → v1 のパターンの順）になること。
// v1 で throw していた「引数が無い」場面だけ、自動取得に回す。
// v2 の判定の層（resolve）は使わない。policy / getter が無く、エラーを v1 のメッセージに戻すには取得の層を直接呼ぶ必要があり、
// Expo Go や ios / android 以外の OS の skip（v2 の判定）も checkVersion では行わない（v1 と同じく判定する）ため
import { Platform } from 'react-native';

import {
  type CompareDetail,
  type CompareResult,
  compareVersion,
  toDetail,
} from './compare.ts';
import { nativeAppId, nativeVersion } from './detect.ts';
import { StoreVersionError } from './errors.ts';
import { extractPlayVersion, playStoreUrl } from './fetchers/android.ts';
import { appIdFromStoreUrl, lookupIOS } from './fetchers/ios.ts';
import { failedResponseStatusOf, requestText } from './request.ts';

/** {@link checkVersion} の引数。v2 ではすべて省略できる */
export type CheckVersionParams = {
  /**
   * アプリのバージョン。必ずネイティブのバージョン（iOS の `CFBundleShortVersionString` / Android の `versionName`）を渡す。
   * `Constants.expoConfig.version` や `package.json` の値は JS バンドルに含まれ、OTA 更新で変わってしまう
   * （ネイティブは古いのに「更新済み」と誤判定する）ので使わないこと。
   *
   * 省略（空文字も含む）すると、iOS / Android では expo-application の `nativeApplicationVersion` →
   * react-native-device-info の `getVersion()` の順に取る。取れなければ `local version is not set.` を throw する。
   * Expo Go の中では Expo Go 自体のバージョンが取れてしまうので、Expo Go で試すときは明示的に渡すこと
   */
  version?: string;
  /**
   * App Store の URL（`https://apps.apple.com/jp/app/github/id1477376905` など。`id<数字>` から App ID を取る）。
   * 省略（空文字も含む）すると、iOS ではアプリの bundleId（expo-application の `applicationId` →
   * react-native-device-info の `getBundleId()`）で引く。取れなければ `iosStoreURL is not set.` を throw する。
   * Expo Go の中で省略すると Expo Go 自体（`host.exp.Exponent`）を引いてしまうので、Expo Go で試すときは URL も明示すること
   */
  iosStoreURL?: string;
  /**
   * Google Play の URL（`https://play.google.com/store/apps/details?id=<package>`）。
   * 省略（空文字も含む）すると、Android ではアプリの package name（expo-application の `applicationId` →
   * react-native-device-info の `getBundleId()`）から URL を組み立てる。取れなければ `androidStoreURL is not set.` を throw する。
   * Expo Go の中で省略すると Expo Go 自体（`host.exp.exponent`）を引いてしまうので、Expo Go で試すときは URL も明示すること
   */
  androidStoreURL?: string;
  /** iTunes Lookup の国コード（iOS のみ）。省略（空文字も含む）すると `jp`（v1 と同じ） */
  country?: string;
  /**
   * ストアへの問い合わせのタイムアウト（ms）。省略するとタイムアウトしない（v1 と同じ）。
   * 正の有限の数のときだけ有効（0・負の数・NaN・Infinity はタイムアウトなし）。
   * 時間切れのときは `StoreVersionError`（`code: 'TIMEOUT'`）を throw する
   */
  timeoutMs?: number;
};

/** {@link checkVersion} の戻り値（v1 と同じ形） */
export type CheckVersionResponse = {
  /** アプリのバージョン（渡した値か、自動取得した値） */
  local: string;
  /** ストアのバージョン */
  remote: string;
  /** `remote` が新しければ `new`、古ければ `old`、同じなら `equal` */
  result: CompareResult;
  detail: CompareDetail;
};

/*
 * v1 のエラーメッセージへの対応表（v1 の src/index.ts / ios.ts / android.ts の全経路）。
 * 取得の段階で起きたものは、v1 と同じく `new Error(e.message)`（Error でなければ `can't get ${Platform.OS} version`）で
 * 投げ直す。v2 の層の `StoreVersionError` は {@link toV1Error} で v1 のメッセージに戻す。
 *
 * | 経路（v1）                                          | v1 のメッセージ                       | v2 の層での扱い                                         | checkVersion が投げるもの             |
 * |-----------------------------------------------------|---------------------------------------|---------------------------------------------------------|---------------------------------------|
 * | `version` が falsy                                   | `local version is not set.`           | ios / android は自動取得。取れなければ v1 と同じ          | 同じ                                  |
 * | iOS で `iosStoreURL` が falsy                        | `iosStoreURL is not set.`             | bundleId を自動取得。取れなければ v1 と同じ               | 同じ                                  |
 * | Android で `androidStoreURL` が falsy                | `androidStoreURL is not set.`         | package name を自動取得。取れなければ v1 と同じ           | 同じ                                  |
 * | iOS の URL が正規表現に合わない                       | `iosStoreURL is invalid.`             | `appIdFromStoreUrl` が null                              | 同じ                                  |
 * | fetch / `text()` が Error で reject                  | 元のメッセージ                        | `requestText` の `NETWORK`（cause に元のエラー）          | `new Error(cause.message)`            |
 * | fetch / `text()` が Error でないもので reject         | `can't get ${Platform.OS} version`    | `NETWORK`（cause が Error でない）                        | 同じ                                  |
 * | iOS の本文が JSON でない（status は見ない）           | `JSON.parse` のメッセージ             | URL: v1 と同じ処理 / bundleId: `NETWORK`（cause に SyntaxError） | `new Error(SyntaxError の message)` |
 * | iOS の `results` が無い・空（`null` の応答も）         | `appID(<id>) is not released.`        | URL: v1 と同じ処理 / bundleId: `NOT_FOUND`                | 同じ（bundleId は `appID(<bundleId>)`）|
 * | iOS の `results[0]` が null など（TypeError）         | TypeError のメッセージ                | URL: v1 と同じ処理 / bundleId: `NETWORK`（cause なし）    | URL: 同じ / bundleId: `can't get ios version` |
 * | iOS の `results[0].version` が文字列でない            | （そのまま remote にして比較で throw） | URL: v1 と同じ処理 / bundleId: `NETWORK`（cause なし）    | URL: 同じ / bundleId: `can't get ios version` |
 * | iOS の 200 以外                                       | （見ない。本文で上のどれかになる）     | URL: v1 と同じ処理 / bundleId: `NETWORK`（cause なし）    | URL: 同じ / bundleId: `can't get ios version` |
 * | Android の URL が正規表現に合わない（ios 以外で省略も） | `androidStoreURL is invalid.`         | checkVersion で検証                                      | 同じ                                  |
 * | Android の 200 以外                                   | `androidStoreURL is invalid.`         | `requestText` の status を checkVersion で見る             | 同じ（package name の経路も）          |
 * | Android の 200 以外で本文の読み込みが失敗              | `androidStoreURL is invalid.`（v1 は本文を読まない） | `NETWORK`（`failedResponseStatusOf` で status が分かる） | 同じ（package name の経路も）          |
 * | Android の 200 で本文の読み込みが失敗                  | 元のメッセージ                        | `NETWORK`（cause に元のエラー）                           | `new Error(cause.message)`            |
 * | Android の版が抽出できない                            | `can't get android app version.`      | `extractPlayVersion` の `PARSE_FAILED` / `INVALID_VERSION`（Varies・比較できない版） | 同じ |
 * | 比較できない local（取得の後）                        | compare-versions のメッセージ          | `compareVersion`（try の外。包まない）                    | 同じ                                  |
 * | （v1 に無い）`timeoutMs` の時間切れ                    | —                                     | `TIMEOUT`                                                | `StoreVersionError('TIMEOUT')` そのまま |
 *
 * iOS の URL 方式は `lookupIOS` を使わず `requestText` で v1 と同じ処理をする。`lookupIOS` は 200 以外を `NETWORK` にし、
 * `country` を encode し、`results[0].version` が文字列でないと `NETWORK` にするので、v1 の結果（本文の JSON を読む）を
 * 再現できないため。Android は 200 以外のメッセージ（`androidStoreURL is invalid.`）を通信の失敗と分けるために、
 * `fetchAndroidVersion` ではなく `requestText` と `extractPlayVersion`（v2 の抽出）を使う。
 * Android の抽出は URL を渡した経路でも v2 のもの（v1 と同じ結果を保つ方針の例外）で、v1 と結果が分かれるのは、版の位置に v1 のパターン
 * （数字とドットだけ）に合わない比較できる版（`5` / `1.0.0-beta.1` / `v2.1` など）がある場合（v1 は抽出できず throw）、
 * 版の位置より前に v1 のパターン（`[[["x.y.z"]],`）の形の別の要素がある場合（v1 はそれを拾う）、版の位置が空なのにほかの場所に
 * v1 のパターンが当たる場合（v1 はそれを拾う）。2026-11-08 の実ページでは v1 のパターンに当たるのは版の位置だけで、v1 と結果は同じだった
 */

/** v1 の `getAndroidVersion` の URL の検証 */
const V1_ANDROID_STORE_URL =
  /^https?:\/\/play\.google\.com\/store\/apps\/details\?id=[0-9a-zA-Z.]+/;

/** 取得の段階で起きたエラーを v1 のメッセージに戻す（上の表） */
const toV1Error = (error: unknown, os: string, appId: string): Error => {
  if (error instanceof StoreVersionError) {
    switch (error.code) {
      // v1 にはタイムアウトが無い（`timeoutMs` を渡したときだけ起きる）ので、code で区別できるようにそのまま投げる
      case 'TIMEOUT':
        return error;
      // 通信の失敗は、v1 と同じく元のエラーのメッセージで投げ直す
      case 'NETWORK':
        return error.cause instanceof Error
          ? new Error(error.cause.message)
          : new Error(`can't get ${os} version`);
      case 'NOT_FOUND':
        return new Error(`appID(${appId}) is not released.`);
      case 'PARSE_FAILED':
      case 'INVALID_VERSION':
        return new Error("can't get android app version.");
    }
  }
  return error instanceof Error
    ? new Error(error.message)
    : new Error(`can't get ${os} version`);
};

type IOSLookupResponse = {
  results?: { length?: number; [index: number]: { version: string } };
} | null;

/** v1 の `getIOSVersion` と同じ処理（status は見ず、本文を JSON として読む）。取得だけ `requestText` に載せる */
const iosVersionByStoreUrl = async (
  appId: string,
  country: string,
  timeoutMs: number | undefined
): Promise<string> => {
  // v1 と同じく country は encode しない。タイムスタンプと no-cache は requestText が付ける
  const { body } = await requestText(
    `https://itunes.apple.com/lookup?id=${appId}&country=${country}`,
    { noCache: true, timeoutMs }
  );
  const response = JSON.parse(body) as IOSLookupResponse;
  // v1 の `!response || !response.results || ...` と同じ（null / false / 0 などの応答も未リリース扱い）
  if (!response?.results || response.results.length === 0) {
    throw new Error(`appID(${appId}) is not released.`);
  }
  return response.results[0].version;
};

/** Play Store のページを取得して版を返す。200 以外は v1 と同じく `androidStoreURL is invalid.` */
const androidVersionByUrl = async (
  url: string,
  timeoutMs: number | undefined
): Promise<string> => {
  let response: { status: number; body: string };
  try {
    response = await requestText(url, { timeoutMs });
  } catch (error) {
    // v1 は status を先に見て、200 以外なら本文を読まない。v2 の request は本文を読むので、その読み込みに失敗しても
    // 200 以外なら v1 と同じメッセージにする
    const status = failedResponseStatusOf(error);
    if (status !== undefined && status !== 200) {
      throw new Error('androidStoreURL is invalid.');
    }
    throw error;
  }
  if (response.status !== 200) {
    throw new Error('androidStoreURL is invalid.');
  }
  return extractPlayVersion(response.body);
};

/**
 * v1 互換のバージョン確認。ストアのバージョンを取得して、`version` と比べた結果を返す。
 *
 * 引数をすべて渡した場合は v1 と同じ結果・同じエラーメッセージになる（`country` の既定も `jp`）。ただし次の 2 点は v1 と違う:
 * - バージョンの比較は compare-versions 6.1.1 の挙動（プレリリースの一部や、先頭の `^` / `~` / `=` / 大文字の `V` などの扱い）
 * - Android の版は v2 の抽出（構造に錨を下ろしたパターン → v1 のパターンの順）で取る。v1 では取れなかった
 *   `5` / `1.0.0-beta.1` のような版も返し、版の位置より前にある古い版は拾わない。版の位置が空なら `can't get android app version.`
 *
 * 省略した引数は、iOS / Android では自動取得する（expo-application か react-native-device-info が必要）。
 * `Platform.OS` が ios / android 以外（web など）のときは v1 と同じく Android の経路で `androidStoreURL` を取得し、自動取得はしない。
 *
 * 失敗は `Error` で reject する（メッセージは v1 と同じ）。`timeoutMs` の時間切れだけは `StoreVersionError`（`code: 'TIMEOUT'`）。
 * Expo Go や web でも判定を省かない（v1 と同じ）。Expo Go の中で version / URL を省略すると Expo Go 自体の値を使ってしまうので、
 * Expo Go で試すときはすべて明示すること。v2 の Provider / hook と違い、起動を止めない仕組みは持たないので、
 * 呼び出し側で catch すること
 *
 * @example
 * import { checkVersion } from 'react-native-store-version';
 *
 * const { result } = await checkVersion({
 *   version: '1.0.0', // ネイティブのバージョン
 *   iosStoreURL: 'https://apps.apple.com/jp/app/github/id1477376905',
 *   androidStoreURL: 'https://play.google.com/store/apps/details?id=com.github.android',
 * });
 */
export const checkVersion = async (
  params: CheckVersionParams = {}
): Promise<CheckVersionResponse> => {
  const os = Platform.OS;
  // 自動取得は ios / android だけ（ほかの OS は v1 と同じ挙動のまま。ネイティブの値がストアの版と対応しないため）
  const autoDetect = os === 'ios' || os === 'android';

  // v1 が `local version is not set.` を投げていた条件（falsy）のときだけ自動取得に回す
  const version = params.version || (autoDetect ? nativeVersion() : null);
  if (!version) {
    throw new Error('local version is not set.');
  }

  let fetchRemote: () => Promise<string>;
  // NOT_FOUND を v1 の `appID(<id>) is not released.` に戻すときの id
  let appId = '';
  if (os === 'ios') {
    const country = params.country || 'jp';
    if (params.iosStoreURL) {
      const storeUrl = params.iosStoreURL;
      fetchRemote = async () => {
        const id = appIdFromStoreUrl(storeUrl);
        if (id === null) {
          throw new Error('iosStoreURL is invalid.');
        }
        return iosVersionByStoreUrl(id, country, params.timeoutMs);
      };
    } else {
      const bundleId = nativeAppId();
      if (bundleId === null) {
        throw new Error('iosStoreURL is not set.');
      }
      appId = bundleId;
      fetchRemote = async () =>
        (
          await lookupIOS({ bundleId }, country, {
            timeoutMs: params.timeoutMs,
          })
        ).version;
    }
  } else if (os === 'android' && !params.androidStoreURL) {
    const packageName = nativeAppId();
    if (packageName === null) {
      throw new Error('androidStoreURL is not set.');
    }
    fetchRemote = () =>
      androidVersionByUrl(playStoreUrl(packageName), params.timeoutMs);
  } else {
    // v1 は ios 以外をすべて Android の経路に進める（web などで省略された場合は `androidStoreURL is invalid.`）。
    // v1 の `getAndroidVersion(storeURL = '')` の既定引数と同じく、undefined のときだけ空文字にする
    const storeUrl =
      params.androidStoreURL === undefined ? '' : params.androidStoreURL;
    fetchRemote = async () => {
      if (!storeUrl.match(V1_ANDROID_STORE_URL)) {
        throw new Error('androidStoreURL is invalid.');
      }
      return androidVersionByUrl(storeUrl, params.timeoutMs);
    };
  }

  let remote: string;
  try {
    remote = await fetchRemote();
  } catch (error) {
    throw toV1Error(error, os, appId);
  }

  // v1 と同じく比較は try の外（比較できない local は compare-versions のメッセージがそのまま出る）
  const result = compareVersion(version, remote);
  return { local: version, remote, result, detail: toDetail(result) };
};
