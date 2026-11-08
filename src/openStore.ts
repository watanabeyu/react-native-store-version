// ストアを開く（4.5、D24）。ストアの URL は常にアプリ自身の ID から求める（開発者が URL や App ID を指定する手段は作らない。
// 指定できると、意図的に別のアプリへ誘導できてしまう）
import { Linking } from 'react-native';

import { playStoreUrl } from './fetchers/android.ts';
import { lookupStoreUrl, type StoreUrlResult } from './fetchers/ios.ts';

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
 * ストアのアプリのページを開く。
 *
 * - iOS: lookup の `trackViewUrl` を開く。取得中なら待ち、失敗していたらもう一度 lookup する。
 *   それも失敗したら `STORE_URL_UNAVAILABLE`（cause に lookup のエラー）で reject する（もう一度呼べば再試行する）
 * - Android: `market://details?id=<package>` を開き、失敗したら `https://play.google.com/store/apps/details?id=<package>`。
 *   `canOpenURL` には頼らない（iOS の LSApplicationQueriesSchemes / Android 11 以降の queries の宣言が要るため）
 *
 * `Linking.openURL` 自体の失敗（iOS / Android の https）は、そのエラーのまま reject する
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
    await Linking.openURL(found.storeUrl);
    return;
  }

  try {
    await Linking.openURL(`market://details?id=${encodeURIComponent(appId)}`);
  } catch {
    // Play ストアのアプリが無い端末（一部のエミュレータ・中国向けの端末など）はブラウザで開く
    await Linking.openURL(playStoreUrl(appId));
  }
};
