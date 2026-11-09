// C3: その ID でストアから引けるか（spec 9.3）。ストアの取得はライブラリ本体の fetcher をそのまま使う
// （アプリが起動時に使うのと同じ取得先・同じ抽出）
import { StoreVersionError } from '../../errors.ts';
import { fetchAndroidVersion } from '../../fetchers/android.ts';
import { lookupIOS } from '../../fetchers/ios.ts';
import type { CheckEntry } from '../result.ts';

/** C3 の 1 回の取得のタイムアウト（ms） */
export const STORE_TIMEOUT_MS = 10_000;

/** C3 で引く ID。無い（null / undefined / 空文字）プラットフォームは飛ばす */
export type StoreIds = {
  /** iOS の bundleId */
  ios?: string | null;
  /** Android の package name */
  android?: string | null;
};

const describeError = (error: unknown): string =>
  error instanceof StoreVersionError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);

const androidFailure = (packageName: string, error: unknown): string => {
  const code = error instanceof StoreVersionError ? error.code : undefined;
  if (code === 'NOT_FOUND') {
    return `package "${packageName}" is not found on Google Play: not published yet, a wrong ID, or not available in the country of this network`;
  }
  // ページは取れたが版を比較できない（Varies with device / `50616-r-2026-11-03` のような版）。アプリの起動時の判定でも
  // ストアの版は使えない（INVALID_VERSION で onError になり UI を出さない）ので、取り直しても直らない失敗として分ける
  if (code === 'INVALID_VERSION') {
    return `package "${packageName}" is on Google Play, but its version cannot be compared (${(error as StoreVersionError).message}). The store version cannot drive force / warning updates, so use getLatestVersion / getMinimumVersion`;
  }
  return `could not get package "${packageName}" from Google Play (access from CI can be unstable): ${describeError(error)}`;
};

/**
 * C3。ID ごとにストアを引き、見つかれば ok（ストアの版を添える）、失敗はすべて warning
 * （`NOT_FOUND` は「ストアに見つからない」。ほかの失敗も、CI からのストア、特に Play Store へのアクセスは不安定なので error にしない）。
 * Android の `INVALID_VERSION`（Google Play にはあるが版を比較できない）は、getLatestVersion / getMinimumVersion を勧める文面にする
 * （iOS の lookupIOS は版を検証しないので INVALID_VERSION にならない）。ID が 1 つも無ければ skipped
 */
export const checkStore = async (
  ids: StoreIds,
  { country }: { country: string }
): Promise<CheckEntry[]> => {
  const tasks: Promise<CheckEntry>[] = [];

  if (ids.ios) {
    const bundleId = ids.ios;
    const where = `the App Store (${country})`;
    tasks.push(
      lookupIOS({ bundleId }, country, { timeoutMs: STORE_TIMEOUT_MS }).then(
        ({ version }): CheckEntry => ({
          id: 'C3',
          level: 'ok',
          message: `bundleId "${bundleId}" is on ${where} (version ${version})`,
        }),
        (error: unknown): CheckEntry => ({
          id: 'C3',
          level: 'warning',
          message:
            error instanceof StoreVersionError && error.code === 'NOT_FOUND'
              ? `bundleId "${bundleId}" is not found on ${where}: not published yet, a wrong ID, or not available in that country`
              : `could not look up bundleId "${bundleId}" on ${where}: ${describeError(error)}`,
        })
      )
    );
  }

  if (ids.android) {
    const packageName = ids.android;
    tasks.push(
      fetchAndroidVersion(
        { packageName },
        { timeoutMs: STORE_TIMEOUT_MS }
      ).then(
        ({ version }): CheckEntry => ({
          id: 'C3',
          level: 'ok',
          message: `package "${packageName}" is on Google Play (version ${version})`,
        }),
        (error: unknown): CheckEntry => ({
          id: 'C3',
          level: 'warning',
          message: androidFailure(packageName, error),
        })
      )
    );
  }

  if (tasks.length === 0) {
    return [
      {
        id: 'C3',
        level: 'skipped',
        message: 'no iOS bundleId or Android package to look up',
      },
    ];
  }
  // 各 task は reject しない（失敗は then の第 2 引数で warning にしている）
  return Promise.all(tasks);
};
