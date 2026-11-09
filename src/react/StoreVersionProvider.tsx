// 判定を 1 つだけ持ち、Context で配下に配る Provider（4.1）。ここは React の配線だけで、状態遷移と副作用は engine.ts。
// 子は判定を待たずに描画する（アプリの起動を止めない）。キャッシュ・永続化はしない（D20）
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ImageSourcePropType } from 'react-native';

import {
  createEngine,
  type Engine,
  IDLE,
  type Model,
  type StoreVersionCheckProps,
  stateOf,
} from './engine.ts';
import type { StoreVersionTexts } from './texts.ts';
import {
  type StoreVersionComponents,
  type StoreVersionDisplay,
  StoreVersionDisplayContext,
  StoreVersionStateContext,
} from './useStoreVersion.ts';

export type { StoreVersionCheckResult } from './engine.ts';
// テストと 3b のデフォルト UI から使う（パッケージの入口からは export しない）
export { DEFAULT_TIMEOUT_MS, defaultCountry } from './engine.ts';

/** {@link StoreVersionProvider} の props */
export type StoreVersionProviderProps = StoreVersionCheckProps & {
  children?: ReactNode;
  /** デフォルト UI の文言 */
  texts?: StoreVersionTexts;
  /** デフォルト UI に表示するアイコン。無ければ表示しない */
  icon?: ImageSourcePropType;
  /** デフォルト UI の中身の差し替え */
  components?: StoreVersionComponents;
  /** false ならデフォルト UI を出さない（hook だけ使う）。既定 true */
  ui?: boolean;
};

// サーバーでの描画（react-native-web の SSR など）では useLayoutEffect が React 18 で警告を出すので、window が無ければ useEffect にする
const useIsomorphicLayoutEffect =
  (globalThis as { window?: unknown }).window === undefined
    ? useEffect
    : useLayoutEffect;

/**
 * ストアのバージョンを確認し、強制 / 警告アップデートを出す Provider。子は判定を待たずに描画する。
 *
 * - 確認するのはマウント時・`recheck()`・（`recheckOnForeground` のとき）バックグラウンドからの復帰時・`enabled` が true になったときだけ。
 *   ほかの props（インラインで書いた `getLatestVersion` なども）が変わっても取り直さない。`policy` が変わったら `action` だけ計算し直す
 * - 再チェックの間（`status: 'checking'`）も前回の判定の結果を見せ続け、再チェックが失敗したら前回の結果に戻す（エラーは `onError` へ）
 * - 判定の途中でバックグラウンドになったら取り消し、復帰時に取り直す（`onError` には渡さない）。
 *   バックグラウンドのままマウントされたら、active になるまで取得を始めない
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
  // 描画中には書かず、commit の後（layout effect。配下の passive effect より先）に書く
  const propsRef = useRef(props);
  useIsomorphicLayoutEffect(() => {
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

  const state = useMemo(
    () => stateOf(model, dismissedRemote, engine),
    [model, dismissedRemote, engine]
  );

  // 表示の設定は別の Context に置く（インラインの texts などで Provider が描画し直しても、hook を使う側は描画し直さない）
  const display = useMemo<StoreVersionDisplay>(
    () => ({ ui: ui ?? true, texts, icon, components }),
    [ui, texts, icon, components]
  );

  // デフォルト UI（display を読んで Force / Warning を重ねる）は 3b。3a では子だけを描画する
  return (
    <StoreVersionStateContext.Provider value={state}>
      <StoreVersionDisplayContext.Provider value={display}>
        {children}
      </StoreVersionDisplayContext.Provider>
    </StoreVersionStateContext.Provider>
  );
};
