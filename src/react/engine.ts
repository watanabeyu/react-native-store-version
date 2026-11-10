// Provider の判定の状態遷移と副作用（取得・AppState・onResult / onError）。React を import しない（React の state へは
// setModel で写すだけ。配線は StoreVersionProvider.tsx）。判定そのものは resolve に任せ、ここでは
// 「いつ取り直すか」「どの結果をどの状態にするか」「どのエラーを onError に渡すか」だけを決める
import { AppState, type AppStateStatus } from 'react-native';

import type { CompareDetail, CompareResult, DiffType } from '../compare.ts';
import { type DetectResult, detect } from '../detect.ts';
import { StoreVersionError } from '../errors.ts';
import type { VersionGetter } from '../fetchers/custom.ts';
import { openStore as openStorePage } from '../openStore.ts';
import {
  type Action,
  evaluatePolicy,
  type Policy,
  validatePolicy,
} from '../policy.ts';
import { isAbortError } from '../request.ts';
import {
  attachedErrorsOf,
  type ResolveResult,
  resolve,
  type StoreUrlResult,
} from '../resolve.ts';
import type {
  StoreVersionStatus,
  UseStoreVersionResult,
} from './useStoreVersion.ts';

// Metro / Babel が定義する開発時のフラグ。react-native の型には無いので、ここで型だけを付ける（無い環境では undefined）
declare const __DEV__: boolean | undefined;

/** 判定全体の既定のタイムアウト（Android の HTML が約 1.25MB あるため） */
export const DEFAULT_TIMEOUT_MS = 10000;

/** `onResult` に渡す値（`ready` になるたびに 1 回） */
export type StoreVersionCheckResult = {
  /** v1 の `checkVersion()` と同じ比較の結果。最新バージョンが比較できず、最低バージョンで force になったときは null */
  result: CompareResult | null;
  detail: CompareDetail | null;
  action: Action;
  diff: DiffType | null;
  local: string;
  /** Play の版が比較できず、最低バージョンで force になったときは null */
  remote: string | null;
};

/** Provider の props のうち、判定に使うもの（表示の props は StoreVersionProvider.tsx） */
export type StoreVersionCheckProps = {
  /**
   * false なら何もしない（`status: 'skipped'`。`onError` も呼ばない）。既定 true。
   * true → false に変わったら判定を取り消して `skipped` にし、false → true に変わったら判定を始める
   */
  enabled?: boolean;
  /**
   * アプリのバージョン。必ずネイティブのバージョン（iOS の `CFBundleShortVersionString` / Android の `versionName`）を渡す。
   * `Constants.expoConfig.version` や `package.json` の値は JS バンドルに含まれ、OTA 更新で変わってしまう
   * （ネイティブは古いのに「更新済み」と誤判定し、force が出なくなる）ので使わないこと。
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
   * ストアとの差分に対する扱い。既定 `{ major: 'force', minor: 'warning', patch: 'warning' }`。
   * `'force'` のような 1 つの値、`{ minor: 'force' }` のような個別指定（省略したキーは既定）、`(local, remote) => Action` の関数で書ける。
   * 変わったら取り直さずに、直近の判定の最新 / 最低バージョンで `action` だけを計算し直す
   * （関数は判定のたびと policy が変わるたびに呼ばれ、インラインで書いた関数は描画のたびに変わる）。
   * 判定が `POLICY_FAILED` で止まり取得結果が無いとき（取得の前に検証で止まった・取得の後に policy の関数が throw した）は、
   * policy を直しても `recheck()` まで `error` のまま。
   *
   * 注意（Android の段階公開）: Android で段階公開を使う場合、公開対象外のユーザーは新バージョンを
   * 入手できないため、ストア差分による `force` でアプリを使えなくなる可能性がある。
   * `Platform.OS === 'android'` のときは `major: 'warning'` にするか、`getMinimumVersion` で
   * force を制御すること。iOS の段階的リリースは自動アップデートの配信ペースだけを制御し、
   * App Store から手動ならいつでも更新できるので問題ない。
   */
  policy?: Policy | null;
  /** 判定全体のタイムアウト（ms）。既定 10000。最新バージョンが間に合わなければ `TIMEOUT`（UI は出さない） */
  timeoutMs?: number;
  /**
   * バックグラウンドからの復帰時（`AppState` が `background` → `active`）にも再チェックする。既定 false。
   * iOS の通知センターや権限ダイアログによる `inactive` → `active` では再チェックしない。
   * Android には `inactive` が無く、権限ダイアログやほかのアプリから戻ったときも `background` → `active` になり再チェックする。
   * Android は再チェックのたびに Play Store のページ（約 1.25MB）を取得する
   */
  recheckOnForeground?: boolean;
  /**
   * 最新バージョンの取得元（Remote Config / 自前の JSON など）。指定するとストアのバージョンは使わない
   * （iOS はストア URL を得るためだけに lookup する。Android はストアに問い合わせない）。失敗はストアにフォールバックせず `error`。
   * StrictMode では開発時だけ、マウント時に 2 回呼ばれうる（ストアへの fetch は 1 回にまとまる）
   */
  getLatestVersion?: VersionGetter | null;
  /**
   * 最低バージョンの取得元。これ未満は差分に関係なく force。失敗は最低バージョンの判定だけを飛ばす（`onError` には渡す）。
   * StrictMode では開発時だけ、マウント時に 2 回呼ばれうる
   */
  getMinimumVersion?: VersionGetter | null;
  /**
   * 判定が `ready` になるたびに 1 回呼ぶ（`skipped` / `error` では呼ばない）。
   * Promise を返しても待たない（reject しても unhandled rejection にはしない。開発時は `console.warn`）
   */
  onResult?: (result: StoreVersionCheckResult) => void;
  /**
   * エラーを受け取る（UI は出さない）。1 回の判定で複数回呼ばれうる（例: 最低バージョンの取得の失敗と、
   * 最新バージョンの取得の失敗、iOS のストア URL の lookup の失敗）。判定の取り消し（アンマウント・バックグラウンド）では呼ばない。
   * 再チェックの失敗（前回の結果は残る）と `openStore()` の失敗（`STORE_URL_UNAVAILABLE`）も渡す。
   * 渡さない場合は `__DEV__` のときだけ `console.warn` する。
   * Promise を返しても待たない（reject しても unhandled rejection にはしない。開発時は `console.warn`）
   */
  onError?: (error: StoreVersionError) => void;
};

const LOG_PREFIX = '[react-native-store-version]';

const isDev = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__ === true;

/** locale（BCP 47。`ja-JP` / `zh-Hant-TW` / `en_US`）の地域を小文字の 2 文字で返す。無ければ null */
const regionOf = (locale: unknown): string | null => {
  if (typeof locale !== 'string') {
    return null;
  }
  const subtags = locale.split(/[-_]/);
  // 先頭は言語。2 文字の英字の subtag は地域だけ（extlang は 3 文字、script は 4 文字、variant は 4 文字以上）。
  // 1 文字の subtag（`-u-` などの拡張）から後は見ない。数字 3 桁の地域（`419` など）は国ではないので使わない
  for (let i = 1; i < subtags.length; i += 1) {
    const subtag = subtags[i];
    if (subtag.length === 1) {
      break;
    }
    if (/^[A-Za-z]{2}$/.test(subtag)) {
      return subtag.toLowerCase();
    }
  }
  return null;
};

/**
 * `country` の既定。端末ロケールの地域を JS だけで取る（`Intl.DateTimeFormat().resolvedOptions().locale`）。
 * 取れなければ `us`。例外は投げない（パッケージの入口からは export しない）
 */
export const defaultCountry = (): string => {
  try {
    return regionOf(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'us';
  } catch {
    return 'us';
  }
};

type Evaluation = {
  result: CompareResult | null;
  detail: CompareDetail | null;
  action: Action;
  diff: DiffType | null;
};

/** policy を当て直すために残す、直近の判定の取得結果 */
type Snapshot = {
  latest: string | null;
  minimum: string | null;
  storeUrl: string | null;
  releaseNotes: string | undefined;
};

/** engine の状態。React の state にはこれをそのまま写す */
export type Model = {
  status: StoreVersionStatus;
  local: string | null;
  error: StoreVersionError | null;
  /**
   * 直近の判定の取得結果。`ready`、再チェック中（前回の ready を見せ続ける `checking`）、
   * policy を当て直して `POLICY_FAILED` になった `error` のときにある
   */
  snapshot: Snapshot | null;
  /** 見せる判定の結果。`ready` と、再チェック中（前回の ready の値）のときだけある */
  evaluation: Evaluation | null;
};

export const IDLE: Model = {
  status: 'idle',
  local: null,
  error: null,
  snapshot: null,
  evaluation: null,
};

/** 1 回の判定。取り直すたびに作り直す */
type Run = {
  controller: AbortController;
  /** resolve が終わった（結果を受け取った / エラーにした） */
  settled: boolean;
  /** 判定は終わったが、iOS のストア URL の lookup（getLatestVersion を使うとき）がまだ終わっていない */
  lookupPending: boolean;
};

/** ストアを開くのに要る、直近に検出したアプリ */
type Target = {
  platform: 'ios' | 'android';
  appId: string;
  country: string;
};

/** 直近の判定の最新 / 最低バージョンに policy を当て直す。値で指定した policy は差分によらず検証する（resolve と同じ） */
const reevaluate = (
  local: string,
  snapshot: Snapshot,
  policy: Policy | null | undefined
): { evaluation: Evaluation } | { error: StoreVersionError } => {
  try {
    validatePolicy(policy);
    const { result, detail, action, diff } = evaluatePolicy({
      local,
      remote: snapshot.latest ?? '',
      minimum: snapshot.minimum,
      policy,
    });
    return { evaluation: { result, detail, action, diff } };
  } catch (error) {
    // 取得の結果は resolve で一度判定できているので、ここで投げうるのは policy の POLICY_FAILED だけ
    return { error: error as StoreVersionError };
  }
};

/** Provider の判定の操作（StoreVersionProvider.tsx が effect と hook の値に配線する） */
export type Engine = {
  /** マウント（AppState の購読と最初の判定） */
  mount(): void;
  /** アンマウント（判定を取り消し、それ以降は setState / onResult / onError を呼ばない） */
  unmount(): void;
  /** 判定を始める（`recheck()`）。バックグラウンドの間は active まで待つ */
  start(): void;
  /** `enabled` の切り替え */
  setEnabled(enabled: boolean): void;
  /** `policy` の変更（取り直さずに action を計算し直す） */
  applyPolicy(policy: Policy | null | undefined): void;
  openStore(): Promise<boolean>;
  dismiss(): void;
};

/**
 * Provider の engine を作る。判断はすべてここの変数（最新の値）で行い、React の state は `setModel` で写すだけにする。
 * props はいつも `getProps()` で最新のものを読む（変わっても取り直さない。例外は `enabled` の切り替え）
 */
export const createEngine = (
  getProps: () => StoreVersionCheckProps,
  setModel: (model: Model) => void,
  setDismissedRemote: (remote: string) => void
): Engine => {
  let model: Model = IDLE;
  // マウント中か。false の間は setState も onResult / onError も呼ばない
  let mounted = false;
  // 直近に始めた判定
  let run: Run | null = null;
  // いま見せている結果（ready と、再チェック中に見せ続けている前回の ready）を出した判定。
  // 再チェックの間も、この判定の iOS の URL の lookup は止めずに残し、終わったら見せている結果の storeUrl に反映する
  let shownRun: Run | null = null;
  let target: Target | null = null;
  let storeUrlResult: Promise<StoreUrlResult> | null = null;
  // snapshot の evaluation を計算した policy（policy の変更を見分ける）
  let evaluatedPolicy: Policy | null | undefined;
  // 判定の途中でバックグラウンドになって取り消した。active に戻ったら取り直す
  let abortedByBackground = false;
  // バックグラウンドの間に取得を始めようとした（マウント・recheck・enabled の切り替え）。active になったら始める
  let pendingStart = false;
  // 直近の active の後に background になったか（background → active の復帰だけを見分ける。inactive → active は数えない）
  let wentBackground = false;
  // 直近に見た enabled（false → true / true → false の切り替えを見分ける）
  let lastEnabled = true;
  let subscription: { remove(): void } | null = null;

  const publish = (next: Model) => {
    model = next;
    if (mounted) {
      setModel(next);
    }
  };

  const warnThrown = (name: string, error: unknown) => {
    if (isDev()) {
      console.warn(`${LOG_PREFIX} ${name} threw`, error);
    }
  };

  // 開発者のコールバックが throw しても、Promise を返して reject しても、unhandled rejection にしない（アプリを止めない）。
  // 返した Promise は待たない
  const call = <T>(name: string, fn: (arg: T) => unknown, arg: T) => {
    try {
      const returned = fn(arg);
      if (
        typeof returned === 'object' &&
        returned !== null &&
        typeof (returned as PromiseLike<unknown>).then === 'function'
      ) {
        (returned as PromiseLike<unknown>).then(undefined, (error: unknown) =>
          warnThrown(name, error)
        );
      }
    } catch (error) {
      warnThrown(name, error);
    }
  };

  const report = (error: StoreVersionError) => {
    if (!mounted) {
      return;
    }
    const { onError } = getProps();
    if (onError) {
      call('onError', onError, error);
    } else if (isDev()) {
      console.warn(`${LOG_PREFIX} ${error.code}: ${error.message}`, error);
    }
  };

  const notifyResult = () => {
    const { onResult } = getProps();
    const { evaluation, snapshot, local } = model;
    if (!mounted || !onResult || !evaluation || !snapshot || local === null) {
      return;
    }
    call('onResult', onResult, {
      result: evaluation.result,
      detail: evaluation.detail,
      action: evaluation.action,
      diff: evaluation.diff,
      local,
      remote: snapshot.latest,
    });
  };

  const isCurrent = (r: Run) =>
    mounted && run === r && !r.controller.signal.aborted;

  /** 判定をしない / できない状態にする（前回の結果も消す） */
  const finishWithoutCheck = (next: Model) => {
    target = null;
    storeUrlResult = null;
    publish(next);
  };

  /** 見せている判定の結果（ready と、それを見せ続けている再チェック中）。無ければ null */
  const shownReady = (): Model | null =>
    (model.status === 'ready' || model.status === 'checking') &&
    model.evaluation !== null &&
    model.snapshot !== null
      ? model
      : null;

  /** 前回の判定の、まだ終わっていない iOS の URL の lookup を止める（取り直さない。onError にも渡さない） */
  const stopLookup = (r: Run | null) => {
    if (r?.settled && r.lookupPending) {
      r.controller.abort();
    }
  };

  /**
   * 再チェックが失敗したら、見せ続けていた前回の ready に戻す（force を再チェックの失敗で消さない）。
   * エラーは onError に渡すだけで hook の `error` には入れない（status が ready のまま error だけが入る状態を作らない）。
   * 再チェック中に policy が変わっていたら、前回の取得結果に当て直す
   */
  const restore = () => {
    publish({ ...model, status: 'ready', error: null });
    engine.applyPolicy(getProps().policy);
  };

  /** 判定の結果を受け取ったとき */
  const onResolved = (
    current: Run,
    local: string,
    policy: Policy | null | undefined,
    resolved: ResolveResult
  ) => {
    if (!isCurrent(current)) {
      return;
    }
    current.settled = true;
    const snapshot: Snapshot = {
      latest: resolved.latest,
      minimum: resolved.minimum,
      storeUrl: resolved.storeUrl,
      releaseNotes: resolved.releaseNotes,
    };
    // 判定中に policy が変わっていたら、最新の policy で当て直してから出す（onResult を 2 回呼ばないように）
    const latestPolicy = getProps().policy;
    const outcome =
      latestPolicy === policy
        ? { evaluation: resolved }
        : reevaluate(local, snapshot, latestPolicy);
    evaluatedPolicy = latestPolicy;
    storeUrlResult = resolved.storeUrlResult;
    // 新しい判定の結果を出すので、前回の判定の URL の lookup はもう要らない
    if (shownRun !== current) {
      stopLookup(shownRun);
    }
    shownRun = current;

    if ('error' in outcome) {
      publish({
        status: 'error',
        local,
        error: outcome.error,
        snapshot,
        evaluation: null,
      });
    } else {
      const { result, detail, action, diff } = outcome.evaluation;
      publish({
        status: 'ready',
        local,
        error: null,
        snapshot,
        evaluation: { result, detail, action, diff },
      });
    }
    // 判定を止めなかったエラー（MINIMUM_VERSION_FAILED / INVALID_VERSION）
    for (const error of resolved.errors) {
      report(error);
    }
    if ('error' in outcome) {
      report(outcome.error);
    } else {
      notifyResult();
    }
    watchStoreUrl(current, resolved.storeUrlResult);
  };

  /**
   * iOS で getLatestVersion を使うときは、URL の lookup が終わった時点で storeUrl を更新する。
   * 起動時の URL の lookup の失敗（trackViewUrl が無いことも）は STORE_URL_UNAVAILABLE で onError へ（storeUrlResult は reject しない）。
   * 再チェックの間（この判定の結果を見せ続けている間）に終わったときも、見せている結果に反映する
   */
  const watchStoreUrl = (current: Run, result: Promise<StoreUrlResult>) => {
    current.lookupPending = true;
    void result.then((found) => {
      current.lookupPending = false;
      if (
        !mounted ||
        shownRun !== current ||
        current.controller.signal.aborted
      ) {
        return;
      }
      if (found.error) {
        report(found.error);
        return;
      }
      if (model.snapshot && model.snapshot.storeUrl !== found.storeUrl) {
        publish({
          ...model,
          snapshot: { ...model.snapshot, storeUrl: found.storeUrl },
        });
      }
    });
  };

  /** 判定が失敗したとき（取り消しは何もしない） */
  const onRejected = (current: Run, local: string, error: unknown) => {
    // 取り消した判定（アンマウント・バックグラウンド・取り直し）は何も出さない
    if (!isCurrent(current) || isAbortError(error)) {
      return;
    }
    current.settled = true;
    if (shownReady()) {
      restore();
    } else {
      publish({
        ...IDLE,
        status: 'error',
        local,
        error: error as StoreVersionError,
      });
    }
    report(error as StoreVersionError);
    // 判定を止めたエラーに添えられた、ほかのエラー（その時点で分かっている最低バージョンのエラー）
    for (const attached of attachedErrorsOf(error)) {
      report(attached);
    }
  };

  /** 取得を始める（detect の後。バックグラウンドの間は active まで待つ） */
  const fetchFor = (
    current: Run,
    detected: Extract<DetectResult, { skipped: null }>
  ) => {
    // RN のタイマーはバックグラウンドで止まるので、バックグラウンドの間は取得を始めず、active になったら始める
    if (AppState.currentState === 'background') {
      pendingStart = true;
      return;
    }
    const props = getProps();
    const { platform, version: local, appId } = detected;
    const country = props.country ?? defaultCountry();
    target = { platform, appId, country };
    current.settled = false;
    // 再チェックの間は前回の ready の値を見せ続ける（初回は前回の結果が無い）。
    // 前回の URL の取得結果も、新しい判定が終わるまで openStore に使う
    const previous = shownReady();
    if (previous) {
      publish({ ...previous, status: 'checking', error: null });
    } else {
      storeUrlResult = null;
      publish({ ...IDLE, status: 'checking', local });
    }

    const policy = props.policy;
    // reject は onRejected で受ける（unhandled rejection にしない）
    void resolve({
      platform,
      version: local,
      appId,
      country,
      policy,
      getLatestVersion: props.getLatestVersion,
      getMinimumVersion: props.getMinimumVersion,
      timeoutMs: props.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal: current.controller.signal,
    }).then(
      (resolved) => onResolved(current, local, policy, resolved),
      (error: unknown) => onRejected(current, local, error)
    );
  };

  const start = () => {
    if (!mounted) {
      return;
    }
    pendingStart = false;
    abortedByBackground = false;
    // 判定中なら取り消す（onError には渡さない）。同じストアへの取得は request.ts が次の判定に引き継ぐ。
    // 判定が終わって URL の lookup だけが残っている判定は止めない（前回の結果の storeUrl に反映するため）
    if (run && !run.settled) {
      run.controller.abort();
    }
    const current: Run = {
      controller: new AbortController(),
      settled: true,
      lookupPending: false,
    };
    run = current;

    // 取得しない（skipped）・できない（LOCAL_VERSION_UNAVAILABLE）は、バックグラウンドでもすぐ決める
    const props = getProps();
    if (props.enabled === false) {
      finishWithoutCheck({ ...IDLE, status: 'skipped' });
      return;
    }
    let detected: DetectResult;
    try {
      detected = detect({
        version: props.version,
        bundleId: props.bundleId,
        packageName: props.packageName,
      });
    } catch (error) {
      // LOCAL_VERSION_UNAVAILABLE
      if (shownReady()) {
        restore();
      } else {
        finishWithoutCheck({
          ...IDLE,
          status: 'error',
          error: error as StoreVersionError,
        });
      }
      // 報告は microtask に回し、そのときまだこの判定が最新のときだけ渡す（StrictMode のマウント・アンマウント・マウントで
      // 1 回目の判定の報告を捨て、2 回報告しないように）
      void Promise.resolve().then(() => {
        if (isCurrent(current)) {
          report(error as StoreVersionError);
        }
      });
      return;
    }
    if (detected.skipped !== null) {
      finishWithoutCheck({ ...IDLE, status: 'skipped' });
      return;
    }
    fetchFor(current, detected);
  };

  const onAppStateChange = (next: AppStateStatus) => {
    if (next === 'background') {
      wentBackground = true;
      // RN のタイマーはバックグラウンドで止まり、復帰時に期限切れで発火する（TIMEOUT になり、この起動で force を出す機会を失う）ので、
      // 終わっていない判定は取り消して、復帰時に取り直す（recheckOnForeground に関係なく）
      if (run && !run.settled && !run.controller.signal.aborted) {
        run.controller.abort();
        abortedByBackground = true;
      }
      // 判定は終わったが iOS の URL の lookup がまだなら、それだけを止める（取り直さない。storeUrlResult はエラーで終わり、
      // openStore はその場で lookup し直す）
      stopLookup(run);
      stopLookup(shownRun);
      return;
    }
    if (next === 'active') {
      const returned = wentBackground;
      wentBackground = false;
      // 待っていた取得の開始・取り消した判定の取り直し・recheckOnForeground が重なっても、始めるのは 1 回
      if (
        pendingStart ||
        (returned &&
          (abortedByBackground || getProps().recheckOnForeground === true))
      ) {
        start();
      }
    }
  };

  const engine: Engine = {
    mount() {
      mounted = true;
      wentBackground = false;
      pendingStart = false;
      lastEnabled = getProps().enabled !== false;
      subscription = AppState.addEventListener('change', onAppStateChange);
      // バックグラウンドのままマウントされたら、取得は active になるまで始めない（status は idle のまま）
      start();
    },
    unmount() {
      // 取り消した後は onResult / onError / setState を呼ばない（resolve の abort は何も添えずに AbortError で終わる）
      mounted = false;
      pendingStart = false;
      subscription?.remove();
      subscription = null;
      run?.controller.abort();
      shownRun?.controller.abort();
      run = null;
      shownRun = null;
    },
    start,
    setEnabled(enabled) {
      if (!mounted || enabled === lastEnabled) {
        return;
      }
      lastEnabled = enabled;
      if (enabled) {
        // false → true: 判定を始める
        start();
        return;
      }
      // true → false: 判定を取り消して skipped にする（onError は呼ばない）
      run?.controller.abort();
      shownRun?.controller.abort();
      run = null;
      shownRun = null;
      pendingStart = false;
      abortedByBackground = false;
      finishWithoutCheck({ ...IDLE, status: 'skipped' });
    },
    applyPolicy(policy) {
      const { snapshot, local } = model;
      // 再チェック中は当て直さない（終わったときに最新の policy で当て直す。失敗したら前回の結果に当て直す）
      if (
        !mounted ||
        model.status === 'checking' ||
        !snapshot ||
        local === null ||
        policy === evaluatedPolicy
      ) {
        return;
      }
      evaluatedPolicy = policy;
      const outcome = reevaluate(local, snapshot, policy);
      if ('error' in outcome) {
        // 不正な policy が続く（インラインで書いた関数が描画のたびに throw するなど）間は、onError を繰り返さない
        if (model.status === 'ready') {
          publish({
            ...model,
            status: 'error',
            error: outcome.error,
            evaluation: null,
          });
          report(outcome.error);
        }
        return;
      }
      // action が変わらなければ何もしない（インラインで書いた policy で、描画のたびに onResult を呼ばないように）
      if (
        model.status === 'ready' &&
        model.evaluation?.action === outcome.evaluation.action
      ) {
        return;
      }
      publish({
        ...model,
        status: 'ready',
        error: null,
        evaluation: outcome.evaluation,
      });
      notifyResult();
    },
    async openStore() {
      const opening = target;
      if (opening === null) {
        // 判定しない環境（skipped）や、アプリのバージョン / ID が取れなかったときは、開く先が分からない
        report(
          new StoreVersionError(
            'STORE_URL_UNAVAILABLE',
            `cannot open the store: the app was not detected (status: ${model.status})`
          )
        );
        return false;
      }
      try {
        await openStorePage({
          ...opening,
          storeUrl: storeUrlResult,
          timeoutMs: getProps().timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        return true;
      } catch (error) {
        // STORE_URL_UNAVAILABLE（iOS の lookup の失敗 / Linking.openURL の失敗）。onError に渡すだけで reject しない
        // （`onPress={openStore}` のまま使っても unhandled rejection にならないように）。status / error は変えない
        report(error as StoreVersionError);
        return false;
      }
    },
    dismiss() {
      // 再チェック中も、前回の ready の warning なら閉じられる
      const shown = shownReady();
      if (
        mounted &&
        shown?.evaluation?.action === 'warning' &&
        shown.snapshot?.latest != null
      ) {
        setDismissedRemote(shown.snapshot.latest);
      }
    },
  };
  return engine;
};

/**
 * engine の状態から hook の戻り値を作る。判定の結果（result / action / remote / storeUrl など）は ready のとき
 * （再チェック中は前回の ready の値）だけ見せる
 */
export const stateOf = (
  model: Model,
  dismissedRemote: string | null,
  engine: Engine
): UseStoreVersionResult => {
  const evaluation = model.evaluation;
  const snapshot = evaluation ? model.snapshot : null;
  const action = evaluation?.action ?? null;
  const remote = snapshot?.latest ?? null;
  return {
    status: model.status,
    result: evaluation?.result ?? null,
    detail: evaluation?.detail ?? null,
    action,
    diff: evaluation?.diff ?? null,
    // 「あとで」は remote のバージョン単位。remote が変われば解除、force なら常に出す
    dismissed:
      action === 'warning' && remote !== null && remote === dismissedRemote,
    local: model.local,
    remote,
    storeUrl: snapshot?.storeUrl ?? null,
    releaseNotes: snapshot?.releaseNotes,
    openStore: engine.openStore,
    dismiss: engine.dismiss,
    recheck: engine.start,
    error: model.error,
  };
};
