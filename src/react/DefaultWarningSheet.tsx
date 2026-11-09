// Warning（閉じられる警告）のデフォルト UI（4.5、D6）。透過 Modal の下寄せボトムシート。Warning.dc.html の実測値で作る（D50 ⑩）。
// Android の戻るボタンと背景のタップは「あとで」と同じ `dismiss`（D50 ①）。ハンドルは見た目だけ（ドラッグでは閉じない）。
// Provider が `action === 'warning'` かつ `dismissed` でないときだけ描く
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
import type { StoreVersionWarningProps } from './useStoreVersion.ts';

/** モックのオーバーレイ `rgba(0, 0, 0, 0.35)` */
export const WARNING_OVERLAY_COLOR = 'rgba(0, 0, 0, 0.35)';

/** モックどおりのシート（`components.Warning` が無いときの中身） */
const WarningSheet = ({
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
      <Text style={[titleStyle, { color: palette.text }]}>{texts.title}</Text>
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

/**
 * Warning のボトムシート。Modal の枠（戻るボタン・背景タップで `dismiss`・オーバーレイ・a11y）はここが持ち、
 * 中身は `components.Warning` があればそれ、無ければモックどおりのシートを描く（D50 ⑪）
 */
export const DefaultWarningSheet = ({ local }: { local: string }) => {
  const { state, display, texts } = useDefaultUiContext();
  const Custom = display.components?.Warning;
  const props: StoreVersionWarningProps = {
    local,
    remote: state.remote,
    storeUrl: state.storeUrl,
    releaseNotes: state.releaseNotes,
    texts: texts.warning,
    icon: display.icon,
    openStore: state.openStore,
    dismiss: state.dismiss,
  };
  return (
    <ModalFrame
      overlayColor={WARNING_OVERLAY_COLOR}
      onRequestClose={state.dismiss}
      onPressOverlay={state.dismiss}
      placement="bottom"
    >
      {Custom ? <Custom {...props} /> : <WarningSheet {...props} />}
    </ModalFrame>
  );
};

const styles = StyleSheet.create({
  // モック: radius 24px 24px 0 0・padding 12px 24px 40px・gap 14・box-shadow 0 -8px 32px rgba(0,0,0,.2)。
  // 下の padding 40 でホームインジケータのセーフエリアも吸収する（react-native-safe-area-context には依存しない。D50 ⑩）
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.2,
        shadowRadius: 32,
      },
      // Android は elevation に読み替える（影の y オフセットの大きさ 8 を elevation に。elevation は上向きの影を描けない）
      android: { elevation: 8 },
    }),
  },
  // モック: 40×5・radius 3・align-self center・margin-bottom 10（gap 14 と合わせて次の要素まで 24）
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 10,
  },
  // モック: 56×56・radius 13（左寄せ）
  icon: {
    width: 56,
    height: 56,
    borderRadius: 13,
    alignSelf: 'flex-start',
  },
  // モック: ボタンは縦に並べ、ボタン同士 8・ボタンの前の margin-top 8
  buttons: {
    gap: 8,
    marginTop: 8,
  },
});
