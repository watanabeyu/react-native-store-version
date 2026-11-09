// 判定を 1 つだけ持ち、Context で配下に配る Provider（4.1）。判定そのものは resolve（2c）に任せ、
// ここでは「いつ取り直すか」「どの結果をどの状態にするか」「どのエラーを onError に渡すか」だけを決める。
// 子は判定を待たずに描画する（アプリの起動を止めない）。キャッシュ・永続化はしない（D20）
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  type AppStateStatus,
  type ImageSourcePropType,
} from 'react-native';

import type { CompareDetail, CompareResult, DiffType } from '../compare.ts';
import { detect } from '../detect.ts';
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
import { attachedErrorsOf, resolve, type StoreUrlResult } from '../resolve.ts';
import type { StoreVersionTexts } from './texts.ts';
import {
  type StoreVersionComponents,
  StoreVersionContext,
  type StoreVersionContextValue,
  type StoreVersionDisplay,
  type StoreVersionStatus,
  type UseStoreVersionResult,
} from './useStoreVersion.ts';

// Metro / Babel が定義する開発時のフラグ。react-native の型には無いので、ここで型だけを付ける（無い環境では undefined）
declare const __DEV__: boolean | undefined;

/** 判定全体の既定のタイムアウト（D15。Android の HTML が約 1.25MB あるため） */
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

/** {@link StoreVersionProvider} の props */
export type StoreVersionProviderProps = {
  children?: ReactNode;
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
   * Android は再チェックのたびに Play Store のページ（約 1.25MB）を取得する
   */
  recheckOnForeground?: boolean;
  /** デフォルト UI の文言 */
  texts?: StoreVersionTexts;
  /** デフォルト UI に表示するアイコン。無ければ表示しない */
  icon?: ImageSourcePropType;
  /** デフォルト UI の中身の差し替え */
  components?: StoreVersionComponents;
  /** false ならデフォルト UI を出さない（hook だけ使う）。既定 true */
  ui?: boolean;
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
  /** 判定が `ready` になるたびに 1 回呼ぶ（`skipped` / `error` では呼ばない） */
  onResult?: (result: StoreVersionCheckResult) => void;
  /**
   * エラーを受け取る（UI は出さない）。1 回の判定で複数回呼ばれうる（例: 最低バージョンの取得の失敗と、
   * 最新バージョンの取得の失敗、iOS のストア URL の lookup の失敗）。判定の取り消し（アンマウント・バックグラウンド）では呼ばない。
   * 再チェックの失敗（前回の結果は残る）と `openStore()` の失敗（`STORE_URL_UNAVAILABLE`）も渡す。
   * 渡さない場合は `__DEV__` のときだけ `console.warn` する
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
 * `country` の既定（D7）。端末ロケールの地域を JS だけで取る（`Intl.DateTimeFormat().resolvedOptions().locale`）。
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

type Model = {
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

const IDLE: Model = {
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

type Engine = {
  mount(): void;
  unmount(): void;
  start(): void;
  setEnabled(enabled: boolean): void;
  applyPolicy(policy: Policy | null | undefined): void;
  openStore(): Promise<boolean>;
  dismiss(): void;
};

/**
 * Provider の状態遷移と副作用（取得・AppState・onResult / onError）。React の state は publish で写すだけにして、
 * 判断はすべてここの変数（最新の値）で行う。props はいつも getProps() で最新のものを読む（変わっても取り直さない。D50 ⑧。
 * 例外は `enabled` の切り替え。D51）
 */
const createEngine = (
  getProps: () => StoreVersionProviderProps,
  setModel: (model: Model) => void,
  setDismissedRemote: (remote: string) => void
): Engine => {
  let model: Model = IDLE;
  // マウント中か。false の間は setState も onResult / onError も呼ばない
  let active = false;
  let run: Run | null = null;
  let target: Target | null = null;
  let storeUrlResult: Promise<StoreUrlResult> | null = null;
  // snapshot の evaluation を計算した policy（policy の変更を見分ける）
  let evaluatedPolicy: Policy | null | undefined;
  // 判定の途中でバックグラウンドになって取り消した。active に戻ったら取り直す（D50 ②）
  let abortedByBackground = false;
  // バックグラウンドの間に判定を始めようとした（マウント・recheck・enabled の切り替え）。active になったら始める（D51）
  let pendingStart = false;
  // 直近の active の後に background になったか（background → active の復帰だけを見分ける。inactive → active は数えない）
  let wentBackground = false;
  // 直近に見た enabled（false → true / true → false の切り替えを見分ける。D51）
  let lastEnabled = true;
  let subscription: { remove(): void } | null = null;

  const publish = (next: Model) => {
    model = next;
    if (active) {
      setModel(next);
    }
  };

  // 開発者のコールバックが throw しても、判定の Promise を unhandled rejection にしない（アプリを止めない）
  const call = <T,>(name: string, fn: (arg: T) => void, arg: T) => {
    try {
      fn(arg);
    } catch (error) {
      if (isDev()) {
        console.warn(`${LOG_PREFIX} ${name} threw`, error);
      }
    }
  };

  const report = (error: StoreVersionError) => {
    if (!active) {
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
    if (!active || !onResult || !evaluation || !snapshot || local === null) {
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
    active && run === r && !r.controller.signal.aborted;

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

  /**
   * 再チェックが失敗したら、前回の ready に戻す（D51。force を再チェックの失敗で消さない）。
   * エラーは onError に渡すだけで hook の `error` には入れない（status が ready のまま error だけが入る状態を作らない）。
   * 再チェック中に policy が変わっていたら、前回の取得結果に当て直す
   */
  const restore = (previous: Model) => {
    publish({ ...previous, status: 'ready', error: null });
    engine.applyPolicy(getProps().policy);
  };

  const start = () => {
    if (!active) {
      return;
    }
    // RN のタイマーはバックグラウンドで止まるので、バックグラウンドの間は判定を始めず、active になったら始める（D51）
    if (AppState.currentState === 'background') {
      pendingStart = true;
      return;
    }
    pendingStart = false;
    // 判定中なら取り消す（onError には渡さない）。同じストアへの取得は request.ts が次の判定に引き継ぐ
    run?.controller.abort();
    abortedByBackground = false;
    const current: Run = { controller: new AbortController(), settled: true };
    run = current;

    const props = getProps();
    if (props.enabled === false) {
      finishWithoutCheck({ ...IDLE, status: 'skipped' });
      return;
    }
    // 再チェックの間は前回の ready の値を見せ続ける（D51。初回は前回の結果が無い）
    const previous = shownReady();
    let detected: ReturnType<typeof detect>;
    try {
      detected = detect({
        version: props.version,
        bundleId: props.bundleId,
        packageName: props.packageName,
      });
    } catch (error) {
      // LOCAL_VERSION_UNAVAILABLE
      if (previous) {
        restore(previous);
      } else {
        finishWithoutCheck({
          ...IDLE,
          status: 'error',
          error: error as StoreVersionError,
        });
      }
      report(error as StoreVersionError);
      return;
    }
    if (detected.skipped !== null) {
      finishWithoutCheck({ ...IDLE, status: 'skipped' });
      return;
    }

    const { platform, version: local, appId } = detected;
    const country = props.country ?? defaultCountry();
    target = { platform, appId, country };
    current.settled = false;
    if (previous) {
      // 前回の URL の取得結果も、新しい判定が終わるまで openStore に使う
      publish({ ...previous, status: 'checking', error: null });
    } else {
      storeUrlResult = null;
      publish({ ...IDLE, status: 'checking', local });
    }

    const policy = props.policy;
    // reject は下の 2 つ目のハンドラで受ける（unhandled rejection にしない）
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
      (resolved) => {
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
        // 判定を止めなかったエラー（MINIMUM_VERSION_FAILED / D46 ③ の INVALID_VERSION）
        for (const error of resolved.errors) {
          report(error);
        }
        if ('error' in outcome) {
          report(outcome.error);
        } else {
          notifyResult();
        }

        // iOS で getLatestVersion を使うときは、URL の lookup が終わった時点で storeUrl を更新する。
        // 起動時の URL の lookup の失敗（trackViewUrl が無いことも）は STORE_URL_UNAVAILABLE で onError へ（storeUrlResult は reject しない）
        void resolved.storeUrlResult.then((found) => {
          if (!isCurrent(current)) {
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
      },
      (error: unknown) => {
        // 取り消した判定（アンマウント・バックグラウンド・取り直し）は何も出さない
        if (!isCurrent(current) || isAbortError(error)) {
          return;
        }
        current.settled = true;
        if (previous) {
          restore(previous);
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
      }
    );
  };

  const onAppStateChange = (next: AppStateStatus) => {
    if (next === 'background') {
      wentBackground = true;
      // RN のタイマーはバックグラウンドで止まり、復帰時に期限切れで発火する（TIMEOUT になり、この起動で force を出す機会を失う）ので、
      // 終わっていない判定は取り消して、復帰時に取り直す（D50 ②。recheckOnForeground に関係なく）
      if (run && !run.settled && !run.controller.signal.aborted) {
        run.controller.abort();
        abortedByBackground = true;
      }
      return;
    }
    if (next === 'active') {
      const returned = wentBackground;
      wentBackground = false;
      // 待っていた判定の開始・取り消した判定の取り直し・recheckOnForeground が重なっても、始めるのは 1 回
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
      active = true;
      wentBackground = false;
      pendingStart = false;
      lastEnabled = getProps().enabled !== false;
      subscription = AppState.addEventListener('change', onAppStateChange);
      // バックグラウンドのままマウントされたら、active になるまで始めない（status は idle のまま。D51）
      start();
    },
    unmount() {
      // 取り消した後は onResult / onError / setState を呼ばない（resolve の abort は何も添えずに AbortError で終わる）
      active = false;
      pendingStart = false;
      subscription?.remove();
      subscription = null;
      run?.controller.abort();
      run = null;
    },
    start,
    setEnabled(enabled) {
      if (!active || enabled === lastEnabled) {
        return;
      }
      lastEnabled = enabled;
      if (enabled) {
        // false → true: 判定を始める（D51）
        start();
        return;
      }
      // true → false: 判定を取り消して skipped にする（onError は呼ばない。D51）
      run?.controller.abort();
      run = null;
      pendingStart = false;
      abortedByBackground = false;
      finishWithoutCheck({ ...IDLE, status: 'skipped' });
    },
    applyPolicy(policy) {
      const { snapshot, local } = model;
      // 再チェック中は当て直さない（終わったときに最新の policy で当て直す。失敗したら前回の結果に当て直す）
      if (
        !active ||
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
        // （`onPress={openStore}` のまま使っても unhandled rejection にならないように。D51）。status / error は変えない（D50 ③）
        report(error as StoreVersionError);
        return false;
      }
    },
    dismiss() {
      // 再チェック中も、前回の ready の warning なら閉じられる
      const shown = shownReady();
      if (
        active &&
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
 * ストアのバージョンを確認し、強制 / 警告アップデートを出す Provider。子は判定を待たずに描画する。
 *
 * - 確認するのはマウント時・`recheck()`・（`recheckOnForeground` のとき）バックグラウンドからの復帰時・`enabled` が true になったときだけ。
 *   ほかの props（インラインで書いた `getLatestVersion` なども）が変わっても取り直さない。`policy` が変わったら `action` だけ計算し直す
 * - 再チェックの間（`status: 'checking'`）も前回の判定の結果を見せ続け、再チェックが失敗したら前回の結果に戻す（エラーは `onError` へ）
 * - 判定の途中でバックグラウンドになったら取り消し、復帰時に取り直す（`onError` には渡さない）。
 *   バックグラウンドのままマウントされたら、active になるまで判定を始めない
 * - 失敗・タイムアウトでは UI を出さず、エラーを `onError` に渡すだけ（1 回の判定で複数回呼ばれうる）
 * - キャッシュ・永続化はしない。「あとで」（`dismiss`）もメモリだけ
 * - StrictMode では開発時だけ、マウント時に `getLatestVersion` / `getMinimumVersion` が 2 回呼ばれうる（ストアへの fetch は 1 回にまとまる）
 *
 * 判定結果は配下の {@link useStoreVersion} で読める
 */
export const StoreVersionProvider = (props: StoreVersionProviderProps) => {
  const { children, policy, texts, icon, components, ui } = props;
  const [model, setModel] = useState<Model>(IDLE);
  const [dismissedRemote, setDismissedRemote] = useState<string | null>(null);

  // 判定は effect と非同期の続きの中で props を読むので、いつも最新の props を ref で渡す（D50 ⑧）。
  // 描画中には書かず、commit の後（配下の effect より先）に書く
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const engineRef = useRef<Engine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = createEngine(
      () => propsRef.current,
      setModel,
      setDismissedRemote
    );
  }
  const engine = engineRef.current;

  useEffect(() => {
    engine.mount();
    return () => engine.unmount();
  }, [engine]);

  // enabled の切り替えだけは取り直す（false → true で始め、true → false で取り消して skipped。D51）
  const enabled = props.enabled !== false;
  useEffect(() => {
    engine.setEnabled(enabled);
  }, [engine, enabled]);

  useEffect(() => {
    engine.applyPolicy(policy);
  }, [engine, policy]);

  const state = useMemo<UseStoreVersionResult>(() => {
    // 判定の結果（result / action / remote / storeUrl など）は ready のとき（再チェック中は前回の ready の値）だけ見せる（4.2 / D51）
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
      // 「あとで」は remote のバージョン単位（D22）。remote が変われば解除、force なら常に出す
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
  }, [model, dismissedRemote, engine]);

  const display = useMemo<StoreVersionDisplay>(
    () => ({ ui: ui ?? true, texts, icon, components }),
    [ui, texts, icon, components]
  );

  const value = useMemo<StoreVersionContextValue>(
    () => ({ state, display }),
    [state, display]
  );

  // デフォルト UI（display を読んで Force / Warning を重ねる）は 3b。3a では子だけを描画する
  return (
    <StoreVersionContext.Provider value={value}>
      {children}
    </StoreVersionContext.Provider>
  );
};
