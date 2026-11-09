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

import { DefaultForceModal } from './DefaultForceModal.tsx';
import { DefaultWarningSheet } from './DefaultWarningSheet.tsx';
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
  /**
   * デフォルト UI の文言（4.3）。`force` / `warning` ごとに、指定しなかったキーは英語の既定値で補完する。
   * `{remote}`（最新バージョン）/ `{local}`（現在のバージョン）は表示時に置き換える。
   * 日本語は `react-native-store-version/texts/ja`。変えると表示中のモーダルにも即座に反映する（D26）
   */
  texts?: StoreVersionTexts;
  /** デフォルト UI に表示するアイコン（Force はタイトルの上に中央、Warning はシートの左上）。無ければ表示しない（D25） */
  icon?: ImageSourcePropType;
  /**
   * デフォルト UI の中身の差し替え（4.3 の段階 2）。Modal の枠（Force は戻るボタンで閉じない、Warning は戻るボタン・背景タップで
   * `dismiss`、a11y の属性）はライブラリが持ち、差し替えたコンポーネントはその中身を描く（D50 ⑪）
   */
  components?: StoreVersionComponents;
  /** false ならデフォルト UI を出さない（hook だけ使う。4.3 の段階 3）。既定 true */
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

  // デフォルト UI は子の後ろに重ねる（Modal なので描画の位置はレイアウトに影響しない）。出す条件は `action` だけで決める:
  // force なら Force、warning で「あとで」が押されていなければ Warning、それ以外（none / 判定前 / skipped / error）は何も描かない
  // （失敗・タイムアウトでは UI を出さない。原則 3）。再チェック中も前回の `action` が残るので、Force は消えない（D51 ①）。
  // `local` は判定が出ていれば必ずあるが、型の上で null を除くためにここで見る
  const { action, dismissed, local } = state;
  const showUi = display.ui && local !== null;
  return (
    <StoreVersionStateContext.Provider value={state}>
      <StoreVersionDisplayContext.Provider value={display}>
        {children}
        {showUi && action === 'force' ? (
          <DefaultForceModal local={local} />
        ) : null}
        {showUi && action === 'warning' && !dismissed ? (
          <DefaultWarningSheet local={local} />
        ) : null}
      </StoreVersionDisplayContext.Provider>
    </StoreVersionStateContext.Provider>
  );
};
