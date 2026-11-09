// 設定画面の例（spec 4.2 と Settings のモック）。hook でバナーとバージョン情報の行を出す。
// 起動時の warning が「あとで」で閉じられても、`result === 'new'` は残るのでバナーは出続ける
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useStoreVersion } from 'react-native-store-version';
import type { Lang } from './i18n';
import { SETTINGS_TEXTS } from './i18n';

// モックの配色（ライト / ダーク）
const PALETTES = {
  light: {
    appBg: '#F4F4F5',
    card: '#FFFFFF',
    divider: '#E4E4E7',
    text: '#18181B',
    sub: '#52525B',
    chevron: '#A1A1AA',
    primary: '#1D4ED8',
    bannerBg: '#DBEAFE',
    bannerText: '#1E3A8A',
    bannerSub: '#1E40AF',
  },
  dark: {
    appBg: '#18181B',
    card: '#27272A',
    divider: '#3F3F46',
    text: '#FAFAFA',
    sub: '#A1A1AA',
    chevron: '#71717A',
    primary: '#2563EB',
    bannerBg: '#1E3A8A',
    bannerText: '#EFF6FF',
    bannerSub: '#BFDBFE',
  },
} as const;

export type Palette = (typeof PALETTES)[keyof typeof PALETTES];

export const usePalette = (): Palette =>
  useColorScheme() === 'dark' ? PALETTES.dark : PALETTES.light;

/** 新しいバージョンがあるときだけ出すバナー。タップでストアを開く */
const UpdateBanner = ({ lang }: { lang: Lang }) => {
  const { result, remote, openStore } = useStoreVersion();
  const palette = usePalette();
  const t = SETTINGS_TEXTS[lang];
  if (result !== 'new' || remote === null) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        // openStore は reject しない（開けなければ false。失敗は onError に渡る）
        void openStore();
      }}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: palette.bannerBg, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {/* モックの SVG の矢印は RN の文字で代替する */}
      <View style={[styles.bannerIcon, { backgroundColor: palette.primary }]}>
        <Text style={styles.bannerIconText}>↑</Text>
      </View>
      <View style={styles.bannerBody}>
        <Text style={[styles.bannerTitle, { color: palette.bannerText }]}>
          {t.banner(remote)}
        </Text>
        <Text style={[styles.bannerSub, { color: palette.bannerSub }]}>
          {t.bannerSub}
        </Text>
      </View>
      <Text style={[styles.chevron, { color: palette.bannerSub }]}>›</Text>
    </Pressable>
  );
};

/** 「バージョン情報」の行。現在 / 最新を出し、タップで再確認する */
const VersionRow = ({ lang }: { lang: Lang }) => {
  const { local, remote, status, recheck } = useStoreVersion();
  const palette = usePalette();
  const t = SETTINGS_TEXTS[lang];
  const latest = status === 'checking' ? t.checking : (remote ?? '-');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t.recheckHint}
      onPress={recheck}
      style={styles.row}
    >
      <Text style={[styles.rowLabel, { color: palette.text }]}>
        {t.versionInfo}
      </Text>
      <Text style={[styles.rowValue, { color: palette.sub }]}>
        {t.versions(local ?? '-', latest)}
      </Text>
    </Pressable>
  );
};

const LinkRow = ({ label, last }: { label: string; last?: boolean }) => {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.row,
        !last && {
          borderBottomWidth: 1,
          borderBottomColor: palette.divider,
        },
      ]}
    >
      <Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.chevron, { color: palette.chevron }]}>›</Text>
    </View>
  );
};

export const Card = ({ children }: { children: ReactNode }) => {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      {children}
    </View>
  );
};

export const SettingsScreen = ({ lang }: { lang: Lang }) => {
  const palette = usePalette();
  const t = SETTINGS_TEXTS[lang];
  return (
    <View style={styles.screen}>
      <Text style={[styles.title, { color: palette.text }]}>{t.title}</Text>
      <UpdateBanner lang={lang} />
      <Card>
        <LinkRow label={t.notifications} />
        <LinkRow label={t.account} />
        <LinkRow label={t.privacy} last />
      </Card>
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: palette.sub }]}>
          {t.about}
        </Text>
        <Card>
          <VersionRow lang={lang} />
        </Card>
        <Text style={[styles.note, { color: palette.sub }]}>
          {t.recheckHint}
        </Text>
      </View>
    </View>
  );
};

// 寸法と文字はモックの値
const styles = StyleSheet.create({
  screen: {
    gap: 20,
  },
  title: {
    marginHorizontal: 4,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    minHeight: 44,
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerIconText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  bannerSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 52,
  },
  rowLabel: {
    fontSize: 16,
  },
  rowValue: {
    fontSize: 15,
  },
  chevron: {
    fontSize: 20,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    marginHorizontal: 4,
    fontSize: 13,
    lineHeight: 18,
  },
  note: {
    marginHorizontal: 4,
    fontSize: 12,
    lineHeight: 16,
  },
});
