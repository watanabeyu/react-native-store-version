// Warning（閉じられる警告）のデフォルト UI の中身。Warning の元のデザインの実測値で作る。
// Modal の枠（戻るボタン・背景タップ・VoiceOver の escape で `dismiss`、幕、下寄せ、アニメーション）は StoreVersionModal.tsx が持ち、
// ここは `components.Warning` が無いときにその中に描かれるシート。ハンドルは見た目だけ（ドラッグでは閉じない）
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  BUTTON_TEXT_COLOR,
  MAX_CONTENT_WIDTH,
  messageStyle,
  titleStyle,
  usePalette,
} from './defaultUi.tsx';
import type { StoreVersionWarningProps } from './useStoreVersion.ts';

/** デザインの幕 `rgba(0, 0, 0, 0.35)` */
export const WARNING_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.35)';

/**
 * シートの影（デザイン: `box-shadow: 0 -8px 32px rgba(0, 0, 0, .2)`）。iOS は shadow* にそのまま写し、
 * Android は elevation に読み替える（影の y オフセットの大きさ 8 を elevation に。elevation は上向きの影を描けない）
 */
export const sheetShadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 32,
  },
  android: { elevation: 8 },
});

/** デザインどおりのシート（`components.Warning` が無いときの中身）。`texts` は置き換え済み */
export const WarningSheet = ({
  texts,
  icon,
  openStore,
  dismiss,
}: StoreVersionWarningProps) => {
  const palette = usePalette();
  return (
    <View style={[styles.sheet, { backgroundColor: palette.card }]}>
      <View style={[styles.handle, { backgroundColor: palette.handle }]} />
      {icon === undefined ? null : (
        <Image
          source={icon}
          style={[styles.icon, { backgroundColor: palette.iconBg }]}
        />
      )}
      <Text
        accessibilityRole="header"
        style={[titleStyle, { color: palette.text }]}
      >
        {texts.title}
      </Text>
      <Text style={[messageStyle, { color: palette.sub }]}>
        {texts.message}
      </Text>
      <View style={styles.buttons}>
        <ActionButton
          label={texts.update}
          onPress={() => {
            // 開けたかどうかは使わない（失敗は onError に渡る。reject しない）
            void openStore();
          }}
          backgroundColor={palette.primary}
          color={BUTTON_TEXT_COLOR}
        />
        <ActionButton
          label={texts.later}
          onPress={dismiss}
          color={palette.secondaryText}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // デザイン: radius 24px 24px 0 0・padding 12px 24px 40px・gap 14。
  // 下の padding 40 でホームインジケータのセーフエリアも吸収する（react-native-safe-area-context には依存しない）。
  // 幅は画面いっぱい（スマホ縦向きではデザインと同じ）で、最大 480 に抑えて中央に置く（意図的に変える点）
  sheet: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 14,
    ...sheetShadow,
  },
  // デザイン: 40×5・radius 3・align-self center・margin-bottom 10（gap 14 と合わせて次の要素まで 24）
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 10,
  },
  // デザイン: 56×56・radius 13（左寄せ）
  icon: {
    width: 56,
    height: 56,
    borderRadius: 13,
    alignSelf: 'flex-start',
  },
  // デザイン: ボタンは縦に並べ、ボタン同士 8・ボタンの前の margin-top 8
  buttons: {
    gap: 8,
    marginTop: 8,
  },
});
