// `components` で差し替える Force / Warning の例。
// 差し替えられるのはカード / シートの中身だけ。Modal・幕・配置（Force は左右 24 の内側で縦中央、Warning は画面幅で下寄せ）・
// 戻るボタン / 背景タップ・開閉のアニメーションはライブラリが持つ。カード / シートの面（背景・角丸・影・最大幅）はここで描く
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  StoreVersionComponents,
  StoreVersionForceProps,
  StoreVersionWarningProps,
} from 'react-native-store-version';
import { usePalette } from './SettingsScreen';

const CustomForce = ({
  texts,
  icon,
  local,
  remote,
  releaseNotes,
  openStore,
}: StoreVersionForceProps) => {
  const palette = usePalette();
  return (
    <View style={[styles.surface, { backgroundColor: palette.card }]}>
      <View style={styles.header}>
        {icon ? <Image source={icon} style={styles.icon} /> : null}
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          {texts.title}
        </Text>
      </View>
      <Text style={[styles.body, { color: palette.sub }]}>{texts.message}</Text>
      <Text style={[styles.versions, { color: palette.sub }]}>
        {local} → {remote ?? '?'}
      </Text>
      {releaseNotes ? (
        <Text numberOfLines={4} style={[styles.notes, { color: palette.sub }]}>
          {releaseNotes}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void openStore();
        }}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: palette.primary, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={styles.primaryText}>{texts.update}</Text>
      </Pressable>
    </View>
  );
};

const CustomWarning = ({
  texts,
  icon,
  openStore,
  dismiss,
}: StoreVersionWarningProps) => {
  const palette = usePalette();
  return (
    <View
      style={[styles.surface, styles.sheet, { backgroundColor: palette.card }]}
    >
      <View style={styles.header}>
        {icon ? <Image source={icon} style={styles.icon} /> : null}
        <View style={styles.headerText}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: palette.text }]}
          >
            {texts.title}
          </Text>
          <Text style={[styles.body, { color: palette.sub }]}>
            {texts.message}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={dismiss}
          style={({ pressed }) => [
            styles.secondary,
            { borderColor: palette.divider, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.secondaryText, { color: palette.text }]}>
            {texts.later}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void openStore();
          }}
          style={({ pressed }) => [
            styles.primary,
            styles.flex,
            { backgroundColor: palette.primary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.primaryText}>{texts.update}</Text>
        </Pressable>
      </View>
    </View>
  );
};

/** 参照を安定させるため、モジュールの定数にする（描画のたびに作らない） */
export const CUSTOM_COMPONENTS: StoreVersionComponents = {
  Force: CustomForce,
  Warning: CustomWarning,
};

const styles = StyleSheet.create({
  surface: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    padding: 20,
    gap: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#F97316',
  },
  sheet: {
    maxWidth: undefined,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
  },
  versions: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  notes: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  flex: {
    flex: 1,
  },
  primary: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 16,
  },
});
