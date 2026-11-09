// デフォルト UI（Force / Warning）が共有する部品: 配色、Modal の枠（オーバーレイ・配置・a11y）、ボタン、文字のスタイル。
// 値はデザインのモック（docs/v2.0.0/design/project/Main.dc.html / Warning.dc.html）の style と renderVals() から
// そのまま写す（D50 ⑩。目分量で変えない）。RN 標準のコンポーネントだけで作り、依存は足さない（原則 2）
import { type ReactNode, useContext } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  useColorScheme,
  View,
} from 'react-native';

import { resolveTexts, type StoreVersionResolvedTexts } from './texts.ts';
import {
  type StoreVersionDisplay,
  StoreVersionDisplayContext,
  StoreVersionStateContext,
  type UseStoreVersionResult,
} from './useStoreVersion.ts';

/** モックの renderVals() のうち、UI に使う色（appBg / block はモックの背景のダミー画面の色なので実装しない） */
export type Palette = {
  /** カード / シートの背景 */
  card: string;
  /** タイトル */
  text: string;
  /** 本文 */
  sub: string;
  /** 塗りのボタンの背景 */
  primary: string;
  /** `icon` の背景（画像の読み込み中・透過部分に見える） */
  iconBg: string;
  /** Warning のハンドル */
  handle: string;
  /** Warning の「あとで」の文字 */
  secondaryText: string;
};

/** ライト / ダークの配色（Main.dc.html / Warning.dc.html の renderVals()。両方のモックで同じ値） */
export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    card: '#FFFFFF',
    text: '#18181B',
    sub: '#52525B',
    primary: '#1D4ED8',
    iconBg: '#DBEAFE',
    handle: '#D4D4D8',
    secondaryText: '#1D4ED8',
  },
  dark: {
    card: '#27272A',
    text: '#FAFAFA',
    sub: '#D4D4D8',
    primary: '#2563EB',
    iconBg: '#1E3A8A',
    handle: '#52525B',
    secondaryText: '#93C5FD',
  },
};

/** 塗りのボタンの文字（モックは `color: #FFFFFF` 固定。ライト / ダークで変わらない） */
export const BUTTON_TEXT_COLOR = '#FFFFFF';

/** 端末の配色に合わせた色（`useColorScheme`。null（未対応の環境）はライト） */
export const usePalette = (): Palette =>
  PALETTES[useColorScheme() === 'dark' ? 'dark' : 'light'];

/** デフォルト UI が Context から読む値。`texts` は既定値で補完し `{remote}` / `{local}` を置き換え済み */
export type DefaultUiContext = {
  state: UseStoreVersionResult;
  display: StoreVersionDisplay;
  texts: StoreVersionResolvedTexts;
};

/**
 * 判定の状態と表示の設定を読み、文言を解決する。Provider の中でしか描画されないので Context は必ずある。
 * 文言は描画のたびに解決する（`texts` の変更を表示中のモーダルに即座に反映するため。D26）
 */
export const useDefaultUiContext = (): DefaultUiContext => {
  const state = useContext(StoreVersionStateContext);
  const display = useContext(StoreVersionDisplayContext);
  if (state === null || display === null) {
    // Provider が描くので外から到達できない。型を狭めるためだけの throw
    throw new Error(
      'the default UI of react-native-store-version must be rendered by <StoreVersionProvider>'
    );
  }
  const texts = resolveTexts(display.texts, {
    local: state.local,
    remote: state.remote,
  });
  return { state, display, texts };
};

/** {@link ModalFrame} の props */
export type ModalFrameProps = {
  /** オーバーレイの色（Force `rgba(0, 0, 0, 0.55)` / Warning `rgba(0, 0, 0, 0.35)`） */
  overlayColor: string;
  /** Android の戻るボタン。Force は何もしない、Warning は `dismiss` */
  onRequestClose: () => void;
  /** オーバーレイのタップ（Warning の `dismiss`）。無ければタップしても何も起きない（Force） */
  onPressOverlay?: () => void;
  /** 中身の縦の配置。Force は画面の縦中央、Warning は下寄せ */
  placement: 'center' | 'bottom';
  children: ReactNode;
};

/**
 * ライブラリが持つ Modal の枠（D50 ⑪）。透過の Modal に、オーバーレイと中身の配置、a11y の属性を置く。
 * `components` で差し替えても、この枠（戻るボタン・背景タップの扱いと a11y）は変わらない。
 *
 * - 中身の容れ物は `pointerEvents="box-none"` なので、中身の無いところのタップはオーバーレイに届く（Warning は `dismiss`）。
 *   中身の View の上のタップは届かない（`onPress` を持たない View でも、タッチの対象になった時点でオーバーレイは対象外）
 * - `accessibilityViewIsModal` は中身の容れ物に付け、オーバーレイは読み上げから外す（VoiceOver / TalkBack が背後に行かないように）
 * - `statusBarTranslucent`: Android の透過 Modal は既定でステータスバーの下まで広がらず、そこだけ暗くならない帯になるので広げる（iOS では無視される）
 * - アニメーションはモックに無いので既定（none）のまま
 */
export const ModalFrame = ({
  overlayColor,
  onRequestClose,
  onPressOverlay,
  placement,
  children,
}: ModalFrameProps) => {
  const overlayStyle = [styles.overlay, { backgroundColor: overlayColor }];
  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      {onPressOverlay ? (
        <Pressable
          style={overlayStyle}
          onPress={onPressOverlay}
          accessible={false}
          // 読み上げから外すのと同じ理由で、キーボード / D-pad のフォーカスも受けない（Pressable の既定は focusable）
          focusable={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
      ) : (
        <View
          style={overlayStyle}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
      )}
      <View
        style={placement === 'center' ? styles.center : styles.bottom}
        pointerEvents="box-none"
        accessibilityViewIsModal
      >
        {children}
      </View>
    </Modal>
  );
};

/** {@link ActionButton} の props */
export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  /** 塗りの色。無ければ文字だけのボタン（Warning の「あとで」） */
  backgroundColor?: string;
  /** 文字の色 */
  color: string;
};

/**
 * ボタン（モック: 高さ 50・radius 12・文字 16/600）。高さはフォントスケールで伸びるよう `minHeight` にする（D50 ⑩ の意図的な変更）。
 * 押している間だけ `opacity: 0.7`（モックに無いので決めた値。D53）。`allowFontScaling` は切らない（既定 true）
 */
export const ActionButton = ({
  label,
  onPress,
  backgroundColor,
  color,
}: ActionButtonProps) => (
  <Pressable
    accessibilityRole="button"
    onPress={onPress}
    // 押している間だけ薄くする（D53。塗りのボタンも文字だけのボタンも同じ）
    style={({ pressed }) => [
      styles.button,
      backgroundColor === undefined ? null : { backgroundColor },
      pressed ? styles.pressed : null,
    ]}
  >
    <Text style={[styles.buttonText, { color }]}>{label}</Text>
  </Pressable>
);

/** タイトル（モック: 20/28 bold）。フォントはプラットフォーム標準（fontFamily は指定しない） */
export const titleStyle: TextStyle = {
  fontSize: 20,
  lineHeight: 28,
  fontWeight: '700',
};

/** 本文（モック: 15/22） */
export const messageStyle: TextStyle = {
  fontSize: 15,
  lineHeight: 22,
};

const styles = StyleSheet.create({
  // 画面いっぱい（StyleSheet.absoluteFill と同じ。RN 0.88 の型には absoluteFillObject が無いので書き下す）
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Force: 画面の縦中央（モックの top 268px は 844pt の画面での値なので、中央寄せに読み替える。D50 ⑩）
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  // Warning: 下寄せ
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
