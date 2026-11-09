// ストアを開く（4.5、D24）。ストアの URL は常にアプリ自身の ID から求める（開発者が URL や App ID を指定する手段は作らない。
// 指定できると、意図的に別のアプリへ誘導できてしまう）
import { Linking } from 'react-native';

import { StoreVersionError } from './errors.ts';
import { playStoreUrl } from './fetchers/android.ts';
import { lookupStoreUrl, type StoreUrlResult } from './fetchers/ios.ts';

/** `Linking.openURL` の失敗を、lookup の失敗と同じ `STORE_URL_UNAVAILABLE` に包む（cause に元のエラー） */
const openURL = async (url: string): Promise<void> => {
  try {
    await Linking.openURL(url);
  } catch (cause) {
    throw new StoreVersionError(
      'STORE_URL_UNAVAILABLE',
      `could not open the store URL: ${url}`,
      { cause }
    );
  }
};

/** {@link openStore} の引数 */
export type OpenStoreParams = {
  platform: 'ios' | 'android';
  /** iOS は bundleId、Android は package name（detect の `appId`） */
  appId: string;
  /** iOS でもう一度 lookup するときの `country`（判定と同じ値） */
  country: string;
  /**
   * iOS: 判定で取得中 / 取得済みの URL（resolve の `storeUrlResult`）。取得中なら完了を待ってから開き、
   * 失敗していた・渡されなかったら、その場でもう一度 lookup する。Android では使わない
   */
  storeUrl?: PromiseLike<StoreUrlResult> | null;
  /** iOS でもう一度 lookup するときのタイムアウト（ms）。未指定ならタイムアウトしない */
  timeoutMs?: number;
};

/**
 * ストアのアプリのページを開く。失敗はすべて `STORE_URL_UNAVAILABLE`（cause に元のエラー）で reject する
 * （D50 ③。開発者が `onError` だけで失敗を拾えるように、Provider はこのエラーを `onError` にも渡す）。
 *
 * - iOS: lookup の `trackViewUrl` を開く。取得中なら待ち、失敗していたらもう一度 lookup する。
 *   それも失敗したら reject する（cause に lookup のエラー。もう一度呼べば再試行する）。
 *   `Linking.openURL` 自体の失敗も reject する（cause に `Linking.openURL` のエラー）
 * - Android: `market://details?id=<package>` を開き、失敗したら `https://play.google.com/store/apps/details?id=<package>`。
 *   https も失敗したときだけ reject する（cause に https の `Linking.openURL` のエラー）。
 *   `canOpenURL` には頼らない（iOS の LSApplicationQueriesSchemes / Android 11 以降の queries の宣言が要るため）
 */
export const openStore = async ({
  platform,
  appId,
  country,
  storeUrl,
  timeoutMs,
}: OpenStoreParams): Promise<void> => {
  if (platform === 'ios') {
    let found = storeUrl ? await storeUrl : null;
    if (!found || found.error) {
      found = await lookupStoreUrl(appId, country, { timeoutMs });
    }
    if (found.error) {
      throw found.error;
    }
    await openURL(found.storeUrl);
    return;
  }

  try {
    await Linking.openURL(`market://details?id=${encodeURIComponent(appId)}`);
  } catch {
    // Play ストアのアプリが無い端末（一部のエミュレータ・中国向けの端末など）はブラウザで開く
    await openURL(playStoreUrl(appId));
  }
};
