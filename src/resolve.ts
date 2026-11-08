// fetcher / custom / policy / compare を束ねて 1 回の判定を行う層（D38 ⑦）。Provider（Phase 3）はこれを呼ぶだけにする。
// React にも react-native にも依存しない（platform は引数で受け取る。Node でも動く）
import {
  assertValidVersion,
  type CompareDetail,
  type CompareResult,
  type DiffType,
} from './compare.ts';
import { StoreVersionError } from './errors.ts';
import { fetchAndroidVersion, playStoreUrl } from './fetchers/android.ts';
import {
  callLatestVersion,
  callMinimumVersion,
  type VersionGetter,
} from './fetchers/custom.ts';
import {
  lookupIOS,
  lookupStoreUrl,
  type StoreUrlResult,
  storeUrlUnavailable,
  toStoreUrlResult,
} from './fetchers/ios.ts';
import {
  type Action,
  evaluatePolicy,
  minimumVersionError,
  type Policy,
  type PolicyResult,
  validatePolicy,
} from './policy.ts';
import { createAbortError, createScope, raceAbort } from './request.ts';

export type { StoreUrlResult, VersionGetter };

/** {@link resolve} の引数 */
export type ResolveParams = {
  platform: 'ios' | 'android';
  /**
   * アプリのバージョン。必ずネイティブのバージョン（iOS の `CFBundleShortVersionString` / Android の `versionName`）を渡す。
   * `Constants.expoConfig.version` や `package.json` の値は OTA 更新で変わってしまうので使わない
   */
  version: string;
  /** iOS は bundleId、Android は package name */
  appId: string;
  /** iTunes Lookup の `country`（Android では使わない） */
  country: string;
  /** 省略 / null はデフォルト（`{ major: 'force', minor: 'warning', patch: 'warning' }`） */
  policy?: Policy | null;
  /** 指定するとストアのバージョンは使わない（iOS はストア URL を得るためだけに lookup する。Android はストアに問い合わせない） */
  getLatestVersion?: VersionGetter | null;
  /** これ未満は差分に関係なく force */
  getMinimumVersion?: VersionGetter | null;
  /**
   * 判定全体のタイムアウト（ms）。最新バージョンと最低バージョンの取得の両方に同じものが効く。
   * 最新バージョンが間に合わなければ `TIMEOUT` で reject する。最新バージョンが間に合い、最低バージョンだけが
   * 間に合わなければ、最低バージョンの判定だけを飛ばして続ける（`MINIMUM_VERSION_FAILED`。cause に `TIMEOUT`）。
   * 未指定（または正の有限の数でない）ならタイムアウトしない。10 秒の既定は Provider が渡す
   */
  timeoutMs?: number;
  /** 判定の取り消し（abort すると `AbortError` で reject する） */
  signal?: AbortSignal;
};

/** {@link resolve} の結果（判定できたとき） */
export type ResolveResult = {
  /**
   * 最新バージョン（ストア、または `getLatestVersion` の値）。比較できない値でもそのまま入る。
   * Play Store のページから版を取れなかった（Varies with device / 比較できない版）が、最低バージョンで force になったときだけ null
   */
  latest: string | null;
  /** `getMinimumVersion` の値。指定なし（空文字 / null / undefined）・未指定・取得の失敗は null。比較できない値でもそのまま入る */
  minimum: string | null;
  /**
   * 判定の時点で分かっているストアの URL。iOS で URL を取れていない（lookup 中・失敗・`trackViewUrl` が無い）ときは null。
   * 理由は {@link ResolveResult.storeUrlResult} の `error`（lookup 中なら、終わってから受け取れる）
   */
  storeUrl: string | null;
  /**
   * ストアの URL の取得の完了（reject しない）。iOS で `getLatestVersion` を使うときは判定と並行に走る lookup の結果で、
   * 判定はこれを待たずに返る（lookup にも `timeoutMs` と `signal` が効き続ける）。それ以外は判定の時点で完了している。
   * 失敗は `STORE_URL_UNAVAILABLE`（cause に lookup のエラー。タイムアウトなら `TIMEOUT`、`signal` の abort なら `AbortError`）
   */
  storeUrlResult: Promise<StoreUrlResult>;
  /** iOS でストアのバージョンを使ったときの `releaseNotes`。`getLatestVersion` 使用時と Android は undefined */
  releaseNotes?: string;
  /** v1 の `compareVersion(local, latest)` と同じ（policy では変わらない）。最新が比較できず最低バージョンで force になったときは null */
  result: CompareResult | null;
  /** v1 と同じ `detail`。`result` が null なら null */
  detail: CompareDetail | null;
  /** policy と最低バージョンから決まる扱い */
  action: Action;
  /** 差分の種類（`result === 'new'` のときだけ） */
  diff: DiffType | null;
  /**
   * 判定を止めなかったが `onError` に渡すべきエラー（空なら無し）。
   * `MINIMUM_VERSION_FAILED`（getMinimumVersion の失敗・タイムアウト・比較できない最低バージョン）と、
   * 最新が比較できないが最低バージョンで force にしたときの `INVALID_VERSION`（D46 ③）
   */
  errors: readonly StoreVersionError[];
};

// 判定を止めたエラーに添える、止めなかったエラーの一覧。エラーのオブジェクト自体には何も足さない
// （StoreVersionError の形を変えないため）。エラーと一緒に捨てられるので、キャッシュにはならない
const attached = new WeakMap<object, readonly StoreVersionError[]>();

/**
 * {@link resolve} が reject したエラーに添えた、`onError` に渡すべきほかのエラー（無ければ空）。
 * 例: 最新バージョンと最低バージョンがどちらも比較できないときは、reject の `INVALID_VERSION` に
 * `MINIMUM_VERSION_FAILED` が添えてある（D46 の「開発者のバグを onError で気づける」）
 */
export const attachedErrorsOf = (
  error: unknown
): readonly StoreVersionError[] =>
  (typeof error === 'object' && error !== null && attached.get(error)) || [];

const attach = (error: unknown, errors: StoreVersionError[]): unknown => {
  if (errors.length > 0 && typeof error === 'object' && error !== null) {
    attached.set(error, errors);
  }
  return error;
};

type Latest = {
  latest: string | null;
  /** Play Store のページの版が比較できない（Varies with device など）ときの `INVALID_VERSION` */
  latestError?: StoreVersionError;
  /** iOS でストアの lookup を使ったときの trackViewUrl（それ以外は null） */
  storeUrl: string | null;
  releaseNotes?: string;
};

type Minimum = {
  minimum: string | null;
  error?: StoreVersionError;
  /** 呼び出し元の abort で打ち切った */
  aborted?: boolean;
};

const fetchLatest = (
  { platform, appId, country, getLatestVersion }: ResolveParams,
  signal: AbortSignal
): Promise<Latest> => {
  if (getLatestVersion) {
    return callLatestVersion(getLatestVersion, { platform, signal }).then(
      (latest) => ({ latest, storeUrl: null })
    );
  }
  if (platform === 'ios') {
    return lookupIOS({ bundleId: appId }, country, { signal }).then(
      ({ version, storeUrl, releaseNotes }) =>
        releaseNotes === undefined
          ? { latest: version, storeUrl }
          : { latest: version, storeUrl, releaseNotes }
    );
  }
  return fetchAndroidVersion({ packageName: appId }, { signal }).then(
    ({ version }) => ({ latest: version, storeUrl: null }),
    (error: unknown) => {
      // 版を取れない（Varies with device / 比較できない版）でも、最低バージョンが有効で local がそれ未満なら force にする（D46 ③）。
      // ここでは止めずに判定に回す
      if (
        error instanceof StoreVersionError &&
        error.code === 'INVALID_VERSION'
      ) {
        return { latest: null, latestError: error, storeUrl: null };
      }
      throw error;
    }
  );
};

/** 最低バージョンの取得の結果から、`onError` に渡すべきエラー（getter の失敗 / 比較できない値） */
const minimumErrorsOf = (minimum: Minimum | null): StoreVersionError[] => {
  if (!minimum) {
    return [];
  }
  if (minimum.error) {
    return [minimum.error];
  }
  const invalid = minimumVersionError(minimum.minimum);
  return invalid ? [invalid] : [];
};

/**
 * 1 回の判定を行う。latest（ストア / `getLatestVersion`）と minimum（`getMinimumVersion`）は並行に取得し、
 * `evaluatePolicy` で判定する。
 *
 * 判定を止めるエラーは `StoreVersionError` で reject する（`onError` に渡す。UI は出さない）:
 * - `POLICY_FAILED`: 値で指定した policy が不正（取得の前に検証する）/ policy の関数が throw・不正な値
 * - `INVALID_VERSION`: local が比較できない（取得の前に検証する）/ 最新が比較できず、最低バージョンでも force にならない
 * - `TIMEOUT`: 最新バージョン（ストア / `getLatestVersion`）が `timeoutMs` までに取れない
 *   （最低バージョンだけが間に合わないときは止めず、`MINIMUM_VERSION_FAILED` を `errors` に入れて続ける）
 * - `NETWORK` / `NOT_FOUND` / `PARSE_FAILED`: ストアの取得の失敗
 * - `LATEST_VERSION_FAILED`: `getLatestVersion` の失敗（ストアにはフォールバックしない）
 * - `signal` の abort は `AbortError`
 *
 * reject したエラーに、止めなかったエラー（getMinimumVersion の失敗・比較できない最低バージョン）が添えてあれば
 * {@link attachedErrorsOf} で取れる。latest の取得の失敗（`NETWORK` / `NOT_FOUND` / `PARSE_FAILED` / `TIMEOUT` /
 * `LATEST_VERSION_FAILED`）で止めるときは、その時点で getMinimumVersion が完了していれば添え、完了していなければ添えない
 * （待たない）。
 * 判定を止めないエラーは {@link ResolveResult.errors} に入る。
 */
export const resolve = async (
  params: ResolveParams
): Promise<ResolveResult> => {
  const {
    platform,
    version,
    appId,
    country,
    policy,
    getLatestVersion,
    getMinimumVersion,
    timeoutMs,
    signal,
  } = params;
  if (signal?.aborted) {
    throw createAbortError();
  }
  // 取得しても結果が決まっている（必ず error になる）ものは、ストアに問い合わせる前に返す
  validatePolicy(policy);
  assertValidVersion(version, 'local');

  const scope = createScope({ signal, timeoutMs });
  const timeoutError = () =>
    new StoreVersionError(
      'TIMEOUT',
      `the version check timed out after ${timeoutMs}ms`
    );
  const ctx = { platform, signal: scope.signal };

  // getLatestVersion を使う iOS は、ストアの URL だけを判定と並行に lookup する（4.5。判定はこれを待たない）
  let storeUrlLookup: Promise<StoreUrlResult> | null = null;
  const lookedUp: { value: StoreUrlResult | null } = { value: null };
  if (getLatestVersion && platform === 'ios') {
    storeUrlLookup = lookupStoreUrl(appId, country, {
      signal: scope.signal,
    }).then((value) => {
      // タイムアウトで打ち切った lookup の cause は、request の AbortError ではなく TIMEOUT にする
      const result =
        value.error && scope.timedOut
          ? storeUrlUnavailable(timeoutError())
          : value;
      lookedUp.value = result;
      return result;
    });
  }

  // getMinimumVersion が自分で完了した（タイムアウトや abort で打ち切られる前に値を返した / 失敗した）ときの結果。
  // latest の失敗で判定を止めるときに、その時点で分かっている最低バージョンのエラーを添えるため（待たない）
  const minimumDone: { value: Minimum | null } = { value: null };
  const minimumCall = getMinimumVersion
    ? callMinimumVersion(getMinimumVersion, ctx)
    : null;
  minimumCall?.then(
    (minimum) => {
      if (!scope.signal.aborted) {
        minimumDone.value = { minimum };
      }
    },
    (error: StoreVersionError) => {
      if (!scope.signal.aborted) {
        minimumDone.value = { minimum: null, error };
      }
    }
  );

  // minimum は reject しない形にする（latest の失敗で先に抜けても unhandled rejection にならないように）。
  // getter が signal を見なくても、タイムアウトと呼び出し元の abort で打ち切る
  const minimumTask: Promise<Minimum> = minimumCall
    ? raceAbort(minimumCall, scope.signal).then(
        (minimum) => ({ minimum }),
        (error: unknown): Minimum => {
          if (scope.timedOut) {
            // latest が時間内に取れていれば、最低バージョンの判定だけを飛ばして続ける（4.6 / 7 章）
            return {
              minimum: null,
              error: new StoreVersionError(
                'MINIMUM_VERSION_FAILED',
                `getMinimumVersion timed out after ${timeoutMs}ms`,
                { cause: timeoutError() }
              ),
            };
          }
          if (scope.signal.aborted) {
            return { minimum: null, aborted: true };
          }
          return { minimum: null, error: error as StoreVersionError };
        }
      )
    : Promise.resolve({ minimum: null });

  const fail = (error: unknown): never => {
    // 判定をやめたので、まだ走っている取得（getter / URL の lookup）も止める
    scope.abort();
    throw error;
  };

  let latest: Latest;
  try {
    // getter が signal を見なくても、タイムアウトと呼び出し元の abort で打ち切る。latest のタイムアウトは判定全体の TIMEOUT
    latest = await raceAbort(fetchLatest(params, scope.signal), scope.signal);
  } catch (error) {
    // その時点で getMinimumVersion が完了していれば、その失敗・比較できない値も添える（完了していなければ待たずに添えない）
    return fail(
      attach(
        scope.timedOut ? timeoutError() : error,
        minimumErrorsOf(minimumDone.value)
      )
    );
  }
  // latest が取れたら、minimum を同じ期限まで待つ（期限を過ぎたら上で MINIMUM_VERSION_FAILED になる）
  const minimum = await minimumTask;
  if (minimum.aborted) {
    return fail(createAbortError());
  }

  const errors: StoreVersionError[] = [];
  if (minimum.error) {
    errors.push(minimum.error);
  }

  let evaluation: PolicyResult;
  try {
    // 版を取れなかった Play Store（latest が null）は、比較できない remote として判定する（D46 ③）
    evaluation = evaluatePolicy({
      local: version,
      remote: latest.latest ?? '',
      minimum: minimum.minimum,
      policy,
    });
  } catch (error) {
    // evaluatePolicy は最初の 1 つだけを投げるので、getter の失敗・比較できない最低バージョンもここで拾って添える（D46）。
    // latest が null のときに投げられるのは remote の INVALID_VERSION なので、fetcher のエラー（理由が分かる）にする
    return fail(attach(latest.latestError ?? error, minimumErrorsOf(minimum)));
  }

  if (evaluation.minimumError) {
    errors.push(evaluation.minimumError);
  }
  if (evaluation.remoteError) {
    errors.push(latest.latestError ?? evaluation.remoteError);
  }

  let storeUrl: string | null;
  let storeUrlResult: Promise<StoreUrlResult>;
  if (storeUrlLookup) {
    storeUrl = lookedUp.value?.storeUrl ?? null;
    storeUrlResult = storeUrlLookup;
    // URL の lookup が終わるまではタイムアウトと呼び出し元の abort を効かせ続ける（storeUrlLookup は reject しない）
    void storeUrlLookup.then(scope.dispose);
  } else {
    scope.dispose();
    // Android の URL は package name から決まる（openStore は market:// を先に試す）
    const known =
      platform === 'ios'
        ? toStoreUrlResult(latest.storeUrl)
        : { storeUrl: playStoreUrl(appId), error: null };
    storeUrl = known.storeUrl;
    storeUrlResult = Promise.resolve(known);
  }

  const { result, detail, action, diff } = evaluation;
  const resolved: ResolveResult = {
    latest: latest.latest,
    minimum: minimum.minimum,
    storeUrl,
    storeUrlResult,
    result,
    detail,
    action,
    diff,
    errors,
  };
  if (latest.releaseNotes !== undefined) {
    resolved.releaseNotes = latest.releaseNotes;
  }
  return resolved;
};
