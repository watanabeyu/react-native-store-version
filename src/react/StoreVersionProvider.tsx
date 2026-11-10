// 判定を 1 つだけ持ち、Context で配下に配る Provider。ここは React の配線だけで、状態遷移と副作用は engine.ts。
// 子は判定を待たずに描画する（アプリの起動を止めない）。キャッシュ・永続化はしない
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { ColorValue, ImageSourcePropType } from 'react-native';

import {
  createEngine,
  type Engine,
  IDLE,
  type Model,
  type StoreVersionCheckProps,
  stateOf,
} from './engine.ts';
import {
  StoreVersionModal,
  uiKindOf,
  useReduceMotion,
} from './StoreVersionModal.tsx';
import type { StoreVersionTexts } from './texts.ts';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect.ts';
import {
  type StoreVersionComponents,
  type StoreVersionDisplay,
  StoreVersionDisplayContext,
  StoreVersionStateContext,
} from './useStoreVersion.ts';

export type { StoreVersionCheckResult } from './engine.ts';
// テストから使う（パッケージの入口からは export しない）
export { DEFAULT_TIMEOUT_MS, defaultCountry } from './engine.ts';

/** {@link StoreVersionProvider} の props */
export type StoreVersionProviderProps = StoreVersionCheckProps & {
  children?: ReactNode;
  /**
   * デフォルト UI の文言。`force` / `warning` ごとに、指定しなかったキーは英語の既定値で補完する。
   * `{remote}`（最新バージョン）/ `{local}`（現在のバージョン）は表示時に置き換える。
   * 日本語は `react-native-store-version/texts/ja`。変えると表示中のモーダルにも即座に反映する
   */
  texts?: StoreVersionTexts;
  /** デフォルト UI に表示するアイコン（Force はタイトルの上に中央、Warning はシートの左上）。無ければ表示しない */
  icon?: ImageSourcePropType;
  /**
   * デフォルト UI の中身の差し替え。差し替えられるのはカード（Force）/ シート（Warning）の中身だけで、
   * Modal・幕の色・配置・戻るボタン / 背景タップの扱い・開閉のアニメーションはライブラリが持つ。
   * 置かれ方: Force は左右 24 の余白の内側で画面の縦中央、Warning は画面幅で下寄せ。どちらも ScrollView の中。
   * カード / シートの面（背景・角丸・影・最大幅 480）はライブラリは掛けないので、差し替えたコンポーネントが自分で描く
   */
  components?: StoreVersionComponents;
  /**
   * デフォルト UI のボタンの色。「更新」の塗りと「あとで」の文字に使う（「更新」の文字は白のまま）。
   * 省略するとモックの配色（ライト #1D4ED8 / ダーク #2563EB、「あとで」はダークで #93C5FD）。
   * ライト / ダークで同じ色になるので、モードで変えたいときは `useColorScheme()` で分けた値（iOS は `DynamicColorIOS` も可）を渡す。
   * 白の文字と、ダークのシートの背景（#27272A）の上の「あとで」が読める色にすること。`components` で差し替えた中身には効かない
   */
  primaryColor?: ColorValue;
  /** false ならデフォルト UI を出さない（hook だけ使う）。既定 true */
  ui?: boolean;
};

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
  const { children, policy, texts, icon, components, primaryColor, ui } = props;
  const [model, setModel] = useState<Model>(IDLE);
  const [dismissedRemote, setDismissedRemote] = useState<string | null>(null);

  // 判定は effect と非同期の続きの中で props を読むので、いつも最新の props を ref で渡す。
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

  // enabled の切り替えだけは取り直す（false → true で始め、true → false で取り消して skipped）
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
    () => ({ ui: ui ?? true, texts, icon, components, primaryColor }),
    [ui, texts, icon, components, primaryColor]
  );

  // デフォルト UI は子の後ろに重ねる（Modal なので描画の位置はレイアウトに影響しない）。Modal は 1 つだけで、初めて出すものが
  // できたとき（force / warning で未 dismiss）にマウントし、以後はマウントしたまま（閉じている間は visible={false}）。
  // skipped（web / Expo Go / enabled false）や判定前はマウントもしない（描画中の自分の setState。前の描画の値から導く React の書き方）
  const [uiMounted, setUiMounted] = useState(false);
  if (!uiMounted && uiKindOf(state) !== null) {
    setUiMounted(true);
  }

  // 「視差効果を減らす」の設定は Provider で購読する（Modal はマウントと同じ commit で開くので、Modal の中で取りに行くと
  // 初回の表示に間に合わない。ストアへの取得を待つ間に終わる）。ただし、すぐ値を返す getLatestVersion や、出すものがある状態で
  // ui を false → true にした場合は、最初の 1 回の表示に間に合わず動くことがある（既知の制限）。
  // UI を出さない（ui={false}）・skipped の間は購読も取得もしない。
  // idle（マウント直後。skipped かどうかは engine の mount で決まる / バックグラウンドで active を待つ間）も、まだ出すものが無いので取りに行かない
  const reduceMotion = useReduceMotion(
    display.ui && state.status !== 'skipped' && state.status !== 'idle'
  );
  return (
    <StoreVersionStateContext.Provider value={state}>
      <StoreVersionDisplayContext.Provider value={display}>
        {children}
        {display.ui && uiMounted ? (
          <StoreVersionModal reduceMotion={reduceMotion} />
        ) : null}
      </StoreVersionDisplayContext.Provider>
    </StoreVersionStateContext.Provider>
  );
};
