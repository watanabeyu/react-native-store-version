// Force（強制アップデート）のデフォルト UI の中身。Force の元のデザインの実測値で作る。
// 閉じるボタンは無い。Modal の枠（Android の戻るボタンで閉じない、幕、配置、アニメーション）は StoreVersionModal.tsx が持ち、
// ここは `components.Force` が無いときにその中に描かれるカード
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  BUTTON_TEXT_COLOR,
  MAX_CONTENT_WIDTH,
  messageStyle,
  titleStyle,
  usePalette,
} from './defaultUi.tsx';
import type { StoreVersionForceProps } from './useStoreVersion.ts';

/** デザインの幕 `rgba(0, 0, 0, 0.55)` */
export const FORCE_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.55)';

/**
 * カードの影（デザイン: `box-shadow: 0 12px 40px rgba(0, 0, 0, .3)`）。iOS は shadow* にそのまま写し、
 * Android は elevation に読み替える（影の y オフセット 12 を elevation に）。Platform.select はモジュールの読み込み時に評価される
 */
export const cardShadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
  },
  android: { elevation: 12 },
});

/** デザインどおりのカード（`components.Force` が無いときの中身）。`texts` は置き換え済み */
export const ForceCard = ({
  texts,
  icon,
  openStore,
}: StoreVersionForceProps) => {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      {icon === undefined ? null : (
        <Image
          source={icon}
          style={[styles.icon, { backgroundColor: palette.iconBg }]}
        />
      )}
      <Text
        accessibilityRole="header"
        style={[titleStyle, styles.centered, { color: palette.text }]}
      >
        {texts.title}
      </Text>
      <Text style={[messageStyle, styles.centered, { color: palette.sub }]}>
        {texts.message}
      </Text>
      <View style={styles.buttonRow}>
        <ActionButton
          label={texts.update}
          onPress={() => {
            // 開けたかどうかは使わない（失敗は onError に渡る。reject しない）
            void openStore();
          }}
          backgroundColor={palette.primary}
          color={BUTTON_TEXT_COLOR}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // デザイン: left/right 24（枠側の padding で取る）・radius 20・padding 28px 24px 24px・gap 14。
  // 幅は枠いっぱい（スマホ縦向きではデザインと同じ）で、最大 480 に抑えて中央に置く（意図的に変える点）
  card: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    borderRadius: 20,
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 14,
    ...cardShadow,
  },
  // デザイン: 64×64・radius 15・align-self center
  icon: {
    width: 64,
    height: 64,
    borderRadius: 15,
    alignSelf: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  // デザイン: ボタンの前の margin-top 6
  buttonRow: {
    marginTop: 6,
  },
});
