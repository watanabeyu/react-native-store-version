// デフォルト UI（Force / Warning）が共有する部品: 配色、Context の読み取りと文言の解決、ボタン、文字のスタイル、リリースノートの欄。
// 値は元のデザイン（Force / Warning）の style と配色の定義からそのまま写す（目分量で変えない）。
// RN 標準のコンポーネントだけで作り、依存は足さない。Modal の枠は StoreVersionModal.tsx
import { useContext, useMemo } from 'react';
import {
  type ColorValue,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  useColorScheme,
  View,
} from 'react-native';

import {
  formatReleaseDate,
  resolveTexts,
  type StoreVersionResolvedTexts,
} from './texts.ts';
import {
  type StoreVersionDisplay,
  StoreVersionDisplayContext,
  StoreVersionStateContext,
  type UseStoreVersionResult,
} from './useStoreVersion.ts';

/**
 * デザインの配色の定義のうち、UI に使う色。実装から外したキー: appBg / block はデザインの背景のダミー画面の色、
 * iconText はプレースホルダーの "icon" という文字の色（実装では `icon` の画像に置き換わるので当てる先が無い）
 */
export type Palette = {
  /** カード / シートの背景 */
  card: string;
  /** タイトル */
  text: string;
  /** 本文 */
  sub: string;
  /** 塗りのボタンの背景（Provider の `primaryColor` で変えられる） */
  primary: ColorValue;
  /** `icon` の背景（画像の読み込み中・透過部分に見える） */
  iconBg: string;
  /** Warning のハンドル */
  handle: string;
  /** Warning の「あとで」の文字（Provider の `primaryColor` で変えられる） */
  secondaryText: ColorValue;
  /** リリースノートの本文の枠の背景 */
  notesBg: string;
};

/**
 * ライト / ダークの配色（Force / Warning の配色の定義。両方のデザインで同じ値）。
 * リリースノートの本文（`sub`）と枠の背景（`notesBg`）のコントラストは、ライト 7.0:1・ダーク 12.0:1
 */
export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    card: '#FFFFFF',
    text: '#18181B',
    sub: '#52525B',
    primary: '#1D4ED8',
    iconBg: '#DBEAFE',
    handle: '#D4D4D8',
    secondaryText: '#1D4ED8',
    notesBg: '#F4F4F5',
  },
  dark: {
    card: '#27272A',
    text: '#FAFAFA',
    sub: '#D4D4D8',
    primary: '#2563EB',
    iconBg: '#1E3A8A',
    handle: '#52525B',
    secondaryText: '#93C5FD',
    notesBg: '#18181B',
  },
};

/** 塗りのボタンの文字（デザインは `color: #FFFFFF` 固定。ライト / ダークで変わらない） */
export const BUTTON_TEXT_COLOR = '#FFFFFF';

/**
 * カード / シートの最大幅（デザインから意図的に変える点）。タブレットや横向きで画面いっぱいに広がらないようにする。
 * スマホの縦向き（幅 480 未満）では効かないので見た目は変わらない
 */
export const MAX_CONTENT_WIDTH = 480;

/**
 * `primaryColor` として使える値か。JS の利用者が false / '' / null などを渡しても（`isBrand && '#E11D48'` など）、
 * 既定の配色に戻す（そのまま style に入れると塗りが透明になる。`icon` / `texts` と同じ扱い）
 */
const isUsableColor = (value: unknown): value is ColorValue =>
  typeof value === 'string'
    ? value !== ''
    : typeof value === 'number' ||
      (typeof value === 'object' && value !== null);

/**
 * 端末の配色に合わせた色（`useColorScheme`。null（未対応の環境）はライト）。
 * Provider に `primaryColor` があれば、ボタンの塗りと「あとで」の文字をそれにする
 */
export const usePalette = (): Palette => {
  const palette = PALETTES[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const primaryColor = useContext(StoreVersionDisplayContext)?.primaryColor;
  return useMemo(
    () =>
      !isUsableColor(primaryColor)
        ? palette
        : { ...palette, primary: primaryColor, secondaryText: primaryColor },
    [palette, primaryColor]
  );
};

/**
 * `icon` を描くかどうかの正規化。JS からの利用で null / false を渡されても「無し」として扱う
 * （`components` に渡す `icon` も undefined にそろえる）
 */
export const normalizeIcon = (
  icon: ImageSourcePropType | undefined
): ImageSourcePropType | undefined => {
  const value: unknown = icon;
  return value == null || value === false ? undefined : icon;
};

/** デフォルト UI が Context から読む値。`texts` は既定値で補完し `{remote}` / `{local}` を置き換え済み */
export type DefaultUiContext = {
  state: UseStoreVersionResult;
  display: StoreVersionDisplay;
  texts: StoreVersionResolvedTexts;
};

/**
 * 判定の状態と表示の設定を読み、文言を解決する。Provider の中でしか描画されないので Context は必ずある。
 * 文言は `texts` / `local` / `remote` が変わったときだけ解決し直す（`texts` の変更は表示中のモーダルに即座に反映される）
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
  const rawTexts = display.texts;
  const { local, remote } = state;
  const texts = useMemo(
    () => resolveTexts(rawTexts, { local, remote }),
    [rawTexts, local, remote]
  );
  return { state, display, texts };
};

/** {@link ActionButton} の props */
export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  /** 塗りの色。無ければ文字だけのボタン（Warning の「あとで」） */
  backgroundColor?: ColorValue;
  /** 文字の色 */
  color: ColorValue;
};

/**
 * ボタン（デザイン: 高さ 50・radius 12・文字 16/600）。高さはフォントスケールで伸びるよう `minHeight` にする（デザインから意図的に変える点）。
 * 押している間だけ `opacity: 0.7`（デザインに無いので決めた値）。`allowFontScaling` は切らない（既定 true）
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
    style={({ pressed }) => [
      styles.button,
      backgroundColor === undefined ? null : { backgroundColor },
      pressed ? styles.pressed : null,
    ]}
  >
    <Text style={[styles.buttonText, { color }]}>{label}</Text>
  </Pressable>
);

/** タイトル（デザイン: 20/28 bold）。フォントはプラットフォーム標準（fontFamily は指定しない） */
export const titleStyle: TextStyle = {
  fontSize: 20,
  lineHeight: 28,
  fontWeight: '700',
};

/** 本文（デザイン: 15/22） */
export const messageStyle: TextStyle = {
  fontSize: 15,
  lineHeight: 22,
};

/**
 * デフォルト UI にリリースノートの欄を出すか。Provider の `showReleaseNotes` が true のときだけ
 * （`usePalette` が `primaryColor` を読むのと同じく、表示の設定の Context から読む）
 */
export const useShowReleaseNotes = (): boolean =>
  useContext(StoreVersionDisplayContext)?.showReleaseNotes === true;

/** {@link ReleaseNotes} の props */
export type ReleaseNotesProps = {
  /** 見出し（`texts.*.whatsNew`） */
  title: string;
  /** リリースノートの本文（改行は `\n`。加工せずそのまま出す）。無い・空・空白だけなら欄ごと出さない */
  notes: string | undefined;
  /** 公開日（ISO 8601）。無い・日付として読めないときは公開日を出さない */
  releaseDate: string | undefined;
  /** 公開日の書式（`texts.*.releaseDate`） */
  dateFormat: string;
  /** 本文の枠の高さの上限（デザイン: Force 180 / Warning 140） */
  maxHeight: number;
  palette: Palette;
};

/**
 * リリースノートの欄（Force / Warning で共通。Provider の `showReleaseNotes` が true で、リリースノートがあるときだけ出す。
 * リリースノートが無い・空白だけなら欄ごと出さない（公開日だけは出さない）。デザイン: 見出しと公開日の行、その下に本文の枠）。
 * 本文は枠の中でスクロールする（カード / シート自体が ScrollView の中なので `nestedScrollEnabled`）。高さに上限があるので、
 * 長いリリースノートや大きいフォントでもボタンが画面に残る。Force のカードも Warning のシートも見出し・本文は中央揃えだが、欄の中は左寄せ。
 * 枠の padding は `contentContainerStyle` に置く（デザインの CSS と同じく、余白も本文と一緒にスクロールする）
 */
export const ReleaseNotes = ({
  title,
  notes,
  releaseDate,
  dateFormat,
  maxHeight,
  palette,
}: ReleaseNotesProps) => {
  const showReleaseNotes = useShowReleaseNotes();
  // 空白だけかどうかは判定にだけ使い、本文は加工せずに出す
  if (!showReleaseNotes || notes === undefined || notes.trim() === '') {
    return null;
  }
  const date = formatReleaseDate(dateFormat, releaseDate);
  return (
    <View style={styles.notes}>
      <View style={styles.notesHeader}>
        <Text
          accessibilityRole="header"
          style={[styles.notesTitle, { color: palette.text }]}
        >
          {title}
        </Text>
        {date === undefined ? null : (
          <Text style={[styles.notesDate, { color: palette.sub }]}>{date}</Text>
        )}
      </View>
      <ScrollView
        nestedScrollEnabled
        style={[
          styles.notesBox,
          { maxHeight, backgroundColor: palette.notesBg },
        ]}
        contentContainerStyle={styles.notesBoxContent}
      >
        <Text style={[styles.notesBody, { color: palette.sub }]}>{notes}</Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  // デザイン: 見出しの行と本文の枠を縦に並べて gap 8・margin-top 2（カード / シートの gap 14 に足す）
  notes: {
    gap: 8,
    marginTop: 2,
  },
  // デザイン: 見出しと公開日を 1 行に（align-items baseline・gap 8）
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  // デザイン: 14/20 semibold・flex 1（公開日を右端に押す）
  notesTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  // デザイン: 13/18
  notesDate: {
    fontSize: 13,
    lineHeight: 18,
  },
  // デザイン: radius 12（max-height は Force / Warning で違うので引数）
  notesBox: {
    borderRadius: 12,
  },
  // デザイン: padding 12px 14px
  notesBoxContent: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  // デザイン: 14/20
  notesBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    // 押せる範囲の余白。文字 16 の行の高さ（約 22）+ 上下 8 ずつは minHeight 50 に収まるので、デザインの見た目の大きさは変わらない。
    // 文字が長くて折り返したときや大きいフォントでは、文字が端に貼り付かずに済む
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
