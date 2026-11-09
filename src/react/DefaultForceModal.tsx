// Force（強制アップデート）のデフォルト UI（4.5）。Main.dc.html の実測値で作る（D50 ⑩）。
// 閉じるボタンは無く、Android の戻るボタン（onRequestClose）でも閉じない。Provider が `action === 'force'` のときだけ描く
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  BUTTON_TEXT_COLOR,
  ModalFrame,
  messageStyle,
  titleStyle,
  useDefaultUiContext,
  usePalette,
} from './defaultUi.tsx';
import type { StoreVersionForceProps } from './useStoreVersion.ts';

/** モックのオーバーレイ `rgba(0, 0, 0, 0.55)` */
export const FORCE_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.55)';

// Android の戻るボタンでは閉じない（何もしない）
const ignoreRequestClose = () => {};

/** モックどおりのカード（`components.Force` が無いときの中身） */
const ForceCard = ({ texts, icon, openStore }: StoreVersionForceProps) => {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      {icon === undefined ? null : (
        <Image
          source={icon}
          style={[styles.icon, { backgroundColor: palette.iconBg }]}
        />
      )}
      <Text style={[titleStyle, styles.centered, { color: palette.text }]}>
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

/**
 * Force のモーダル。Modal の枠（戻るボタン無効・オーバーレイ・a11y）はここが持ち、中身は `components.Force` があればそれ、
 * 無ければモックどおりのカードを描く（D50 ⑪）。`local` は判定が出ていれば必ずあるので、Provider は `local` があるときだけ描く
 */
export const DefaultForceModal = ({ local }: { local: string }) => {
  const { state, display, texts } = useDefaultUiContext();
  const Custom = display.components?.Force;
  const props: StoreVersionForceProps = {
    local,
    remote: state.remote,
    storeUrl: state.storeUrl,
    releaseNotes: state.releaseNotes,
    texts: texts.force,
    icon: display.icon,
    openStore: state.openStore,
  };
  return (
    <ModalFrame
      overlayColor={FORCE_OVERLAY_COLOR}
      onRequestClose={ignoreRequestClose}
      placement="center"
    >
      {Custom ? <Custom {...props} /> : <ForceCard {...props} />}
    </ModalFrame>
  );
};

const styles = StyleSheet.create({
  // モック: left/right 24・radius 20・padding 28px 24px 24px・gap 14・box-shadow 0 12px 40px rgba(0,0,0,.3)
  card: {
    marginHorizontal: 24,
    borderRadius: 20,
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 40,
      },
      // Android は elevation に読み替える（影の y オフセット 12 を elevation に）
      android: { elevation: 12 },
    }),
  },
  // モック: 64×64・radius 15・align-self center
  icon: {
    width: 64,
    height: 64,
    borderRadius: 15,
    alignSelf: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  // モック: ボタンの前の margin-top 6
  buttonRow: {
    marginTop: 6,
  },
});
