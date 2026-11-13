// React の外で使う、1 回のバージョン確認。Provider と同じ detect（自動取得と skip の判定）と resolve（取得と比較）に載せ、
// 結果をそのまま返す。UI を出さず、policy（モーダルの出し方）も持たない。失敗は reject で返す。
// react/engine.ts は import しない（AppState などの Provider の仕組みを連れてこないため。既定値は detect.ts から取る）
import {
  type CompareDetail,
  type CompareResult,
  compareVersion,
  type DiffType,
} from './compare.ts';
import {
  DEFAULT_TIMEOUT_MS,
  defaultCountry,
  detect,
  type SkipReason,
} from './detect.ts';
import { StoreVersionError, type StoreVersionErrorCode } from './errors.ts';
import type { VersionGetter } from './fetchers/custom.ts';
import { createAbortError } from './request.ts';
import { type ResolveResult, resolve } from './resolve.ts';

/** {@link checkVersion} の引数。すべて省略できる */
export type CheckVersionParams = {
  /**
   * アプリのバージョン。必ずネイティブのバージョン（iOS の `CFBundleShortVersionString` / Android の `versionName`）を渡す。
   * `Constants.expoConfig.version` や `package.json` の値は JS バンドルに含まれ、OTA 更新で変わってしまう
   * （ネイティブは古いのに「更新済み」と誤判定する）ので使わないこと。
   * 省略すると expo-application の `nativeApplicationVersion` → react-native-device-info の `getVersion()` の順に取る
   */
  version?: string | null;
  /** iOS の bundleId。省略すると expo-application の `applicationId` → react-native-device-info の `getBundleId()` の順に取る */
  bundleId?: string | null;
  /** Android の package name。省略すると expo-application の `applicationId` → react-native-device-info の `getBundleId()` の順に取る */
  packageName?: string | null;
  /** iTunes Lookup の国（`jp` など）。既定は端末ロケールの地域（取れなければ `us`） */
  country?: string;
  /**
   * 確認全体のタイムアウト（ms）。既定 10000。最新バージョンと最低バージョンの取得の両方に同じものが効く
   * （正の有限の数でなければタイムアウトしない）。最新バージョンが間に合わなければ `TIMEOUT`、
   * 最低バージョンだけが間に合わなければ `MINIMUM_VERSION_FAILED` で reject する
   */
  timeoutMs?: number;
  /** 確認の取り消し。abort すると `signal.reason` で reject する */
  signal?: AbortSignal;
  /**
   * 最新バージョンの取得元（Remote Config / 自前の JSON など）。指定するとストアのバージョンは使わず、
   * ストアにも問い合わせない。throw する・空文字 / null / undefined・文字列でない値を返すと `LATEST_VERSION_FAILED`
   * （ストアにはフォールバックしない）
   */
  getLatestVersion?: VersionGetter;
  /**
   * 最低バージョンの取得元。結果の `minimum` / `belowMinimum` に使う。空文字 / null / undefined は「指定なし」
   * （`minimum` は null）。throw する・文字列でない値や比較できない値を返す・間に合わないと `MINIMUM_VERSION_FAILED`
   */
  getMinimumVersion?: VersionGetter;
};

/**
 * {@link checkVersion} の結果。
 * - `skipped`: 確認しない環境（`web` / ios・android 以外の `unsupported-platform` / `expo-go`）。ストアには問い合わせない
 * - `ready`: 確認できた
 */
export type CheckVersionResult =
  | { status: 'skipped'; reason: SkipReason }
  | {
      status: 'ready';
      /** アプリのバージョン（渡した値か、自動取得した値） */
      local: string;
      /** 最新バージョン（ストア、または `getLatestVersion` の値） */
      remote: string;
      /** `remote` が新しければ `new`、古ければ `old`、同じなら `equal`（`compareVersion(local, remote)` と同じ） */
      result: CompareResult;
      detail: CompareDetail;
      /** 差分の種類。`result` が `new` のときだけ値があり、それ以外は null */
      diff: DiffType | null;
      /** `getMinimumVersion` の値。渡していない、または空なら null */
      minimum: string | null;
      /** `local` が `minimum` より古いか。`minimum` が null なら false */
      belowMinimum: boolean;
      /**
       * ストアの今の版のリリースノート（ストアの「新機能」。改行は `\n`）。iOS / Android とも。
       * `getLatestVersion` を使ったときと、ストアから取れなかった（無い・空）ときは undefined
       */
      releaseNotes: string | undefined;
      /**
       * ストアの今の版の公開日（ISO 8601 の UTC で秒まで。`2026-11-05T22:49:03Z`）。iOS / Android とも。
       * `getLatestVersion` を使ったときと、ストアから取れなかったときは undefined
       */
      releaseDate: string | undefined;
    };

/** resolve が判定を止めずに `errors` に入れたもののうち、指定の code のもの */
const errorOf = (
  resolved: ResolveResult,
  code: StoreVersionErrorCode
): StoreVersionError | undefined =>
  resolved.errors.find((error) => error.code === code);

/**
 * ストアのバージョン（または `getLatestVersion` の値）を取得して、アプリのバージョンと比べる。
 * React の外（起動時の処理・バックグラウンドの処理など）で確かめるための関数で、UI は出さない
 * （モーダルを出すなら `StoreVersionProvider` を使う）。キャッシュはしない（同じ取得が重なったときだけ 1 回にまとめる）。
 *
 * 省略した `version` / `bundleId` / `packageName` は自動取得する（expo-application か react-native-device-info が必要）。
 * web・ios / android 以外・Expo Go では確認せず、`{ status: 'skipped', reason }` で resolve する。
 *
 * 失敗はすべて `StoreVersionError`（`code` 付き）で reject する:
 * - `LOCAL_VERSION_UNAVAILABLE`: アプリのバージョン / ID が取れない
 * - `TIMEOUT` / `NETWORK` / `NOT_FOUND` / `PARSE_FAILED`: ストアの取得の失敗
 * - `LATEST_VERSION_FAILED`: `getLatestVersion` の失敗
 * - `INVALID_VERSION`: アプリまたは最新のバージョンが比較できない（Google Play の「Varies with device」など。
 *   `getMinimumVersion` を渡していても reject する）
 * - `MINIMUM_VERSION_FAILED`: `getMinimumVersion` の失敗（最新バージョンが取れていても reject する）
 *
 * `signal` で取り消したときは、`StoreVersionError` ではなく `signal.reason`（無ければ `name === 'AbortError'` のエラー）で reject する。
 *
 * アプリの起動を止めないよう、失敗は `try` / `catch` で受け止めること。
 *
 * @example
 * import { checkVersion, StoreVersionError } from 'react-native-store-version';
 *
 * try {
 *   const check = await checkVersion();
 *   if (check.status === 'ready' && check.result === 'new') {
 *     console.log(`${check.local} → ${check.remote} (${check.diff})`);
 *   }
 * } catch (error) {
 *   // 失敗してもアプリは続ける（ログに残すだけ）
 *   if (error instanceof StoreVersionError) {
 *     console.warn(error.code, error.message);
 *   }
 * }
 */
export const checkVersion = async (
  params: CheckVersionParams = {}
): Promise<CheckVersionResult> => {
  const { signal } = params;
  // skip の判定と自動取得は Provider と同じ（取れなければ LOCAL_VERSION_UNAVAILABLE を投げる）
  const detected = detect({
    version: params.version,
    bundleId: params.bundleId,
    packageName: params.packageName,
  });
  if (detected.skipped !== null) {
    return { status: 'skipped', reason: detected.skipped };
  }
  const { platform, version: local, appId } = detected;

  let resolved: ResolveResult;
  try {
    // policy は渡さない（action を使わない）。ストアの URL も使わないので、iOS で getLatestVersion を使うときの
    // URL だけのための lookup を省く
    resolved = await resolve({
      platform,
      version: local,
      appId,
      country: params.country ?? defaultCountry(),
      getLatestVersion: params.getLatestVersion,
      getMinimumVersion: params.getMinimumVersion,
      timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal,
      storeUrl: false,
    });
  } catch (error) {
    // resolve は取り消しを自前の AbortError で投げるので、呼び出し元が abort に込めた理由に戻す
    // （reason を持たない古い環境では AbortError のまま）
    if (signal?.aborted) {
      throw signal.reason === undefined ? createAbortError() : signal.reason;
    }
    // 判定を止めたエラーに添えられたほかのエラー（attachedErrorsOf）は投げない。reject できるのは 1 つだけなので、止めた理由を返す
    throw error;
  }

  // resolve が判定を止めずに errors に入れたものも、checkVersion では失敗にする（Provider と違い、onError のような別の渡し先が無いため）。
  // 最新が比較できないことを、最低バージョンの失敗より先に返す（比較の結果そのものが無いので）
  const invalid = errorOf(resolved, 'INVALID_VERSION');
  if (invalid) {
    throw invalid;
  }
  const minimumFailed = errorOf(resolved, 'MINIMUM_VERSION_FAILED');
  if (minimumFailed) {
    throw minimumFailed;
  }

  const { latest: remote, result, detail, diff, minimum } = resolved;
  // resolve が latest / result / detail を null にするのは、最新が比較できず INVALID_VERSION を errors に入れたときだけ
  // （上で reject 済み）。型を絞るためのもので、ここには来ない
  if (remote === null || result === null || detail === null) {
    throw new StoreVersionError(
      'INVALID_VERSION',
      'the latest version cannot be compared'
    );
  }
  return {
    status: 'ready',
    local,
    remote,
    result,
    detail,
    diff,
    minimum,
    // minimum は比較できる値（比較できなければ上の MINIMUM_VERSION_FAILED で reject 済み）
    belowMinimum: minimum !== null && compareVersion(local, minimum) === 'new',
    releaseNotes: resolved.releaseNotes,
    releaseDate: resolved.releaseDate,
  };
};
