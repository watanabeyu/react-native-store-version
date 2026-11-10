// react-native-store-version の example。
// - 取得元の 3 パターン（ストア / 静的な JSON / 自前の API のモック）を切り替えて、Force / Warning を出せる
// - 日本語のプリセット（react-native-store-version/texts/ja）、icon、components の差し替え、primaryColor（ボタンの色）、ui={false} を試せる
// - 設定画面のバナーとバージョン情報の行（hook の例）
// - Provider のマウントから onResult / onError までの時間と、v1 との比較（計測）
import { StatusBar } from 'expo-status-bar';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type ImageSourcePropType,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  type StoreVersionCheckResult,
  type StoreVersionError,
  StoreVersionProvider,
} from 'react-native-store-version';
import ja from 'react-native-store-version/texts/ja';
import { CUSTOM_COMPONENTS } from './src/CustomUi';
import type { Lang } from './src/i18n';
import { MeasurePanel } from './src/Measure';
import { Card, SettingsScreen, usePalette } from './src/SettingsScreen';
import { gettersFor, type MockScenario, type Source } from './src/sources';

const ICON: ImageSourcePropType = require('./assets/icon.png');

type Options<T extends string> = readonly { value: T; label: string }[];

const SOURCES: Options<Source> = [
  { value: 'store', label: 'Store' },
  { value: 'json', label: 'JSON' },
  { value: 'api', label: 'API (mock)' },
];

const SCENARIOS: Options<MockScenario> = [
  { value: 'warning', label: 'warning' },
  { value: 'force', label: 'force' },
  { value: 'none', label: 'none' },
  { value: 'fail', label: 'fail' },
];

const LANGS: Options<Lang> = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

const ON_OFF: Options<'on' | 'off'> = [
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
];

// ボタンの色（primaryColor）。既定の配色。アプリのテーマ色の例としてローズ
const COLORS: Options<'default' | 'rose'> = [
  { value: 'default', label: 'default' },
  { value: 'rose', label: 'rose' },
];
const ROSE = '#E11D48';

const MAX_LOG = 8;

/**
 * URL のクエリから設定を読む（シミュレータ / エミュレータで画面を触らずに切り替えるため）。例:
 *   xcrun simctl openurl booted 'rnsv-example://?source=api&scenario=force&lang=ja&icon=on'
 *   adb shell am start -a android.intent.action.VIEW -d 'rnsv-example://?scenario=force'
 * （スキームは app.json の scheme。iOS のシミュレータでは rnsv-example:// に「開きますか？」の確認が出ることがあるので、
 * Expo が登録する bundleId のスキーム com.github.watanabeyu.rnsv.example:// を使うと確認なしで開ける）。measure=on で計測を始める。RN の URLSearchParams は一部しか無いので手で分ける
 */
const parseQuery = (url: string): Record<string, string> => {
  const query = url.split('?')[1]?.split('#')[0] ?? '';
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        // 不正なエスケープ（%E0%A4%A など）は読み飛ばす
      }
    }
  }
  return params;
};

// 起動時の URL（getInitialURL）は、JS のコンテキストごとに 1 回だけ当てる。App が作り直されても（Android でアクティビティが
// 作り直されたときなど）、Fast Refresh でこのファイルが評価し直されても、同じ URL を当て直さないため（印は globalThis に置く）。
// JS をリロードすると当て直される（iOS の launchOptions も Android の intent も残る）ので、URL で起動したあとに戻すときは
// ?scenario=none などを送る
const launch = globalThis as { __rnsvInitialUrlApplied?: boolean };

const pick = <T extends string>(
  options: Options<T>,
  value: string | undefined
): T | undefined => options.find((option) => option.value === value)?.value;

const Segmented = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Options<T>;
  value: T;
  onChange: (value: T) => void;
}) => {
  const palette = usePalette();
  return (
    <View style={styles.control}>
      <Text style={[styles.controlLabel, { color: palette.text }]}>
        {label}
      </Text>
      <View style={styles.segments}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={[
                styles.segment,
                {
                  borderColor: palette.primary,
                  backgroundColor: selected ? palette.primary : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: selected ? '#FFFFFF' : palette.primary },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

type HostProps = {
  source: Source;
  scenario: MockScenario;
  lang: Lang;
  icon: boolean;
  custom: boolean;
  color: 'default' | 'rose';
  ui: boolean;
  onLog: (line: string) => void;
  children: ReactNode;
};

/**
 * Provider を包むだけのコンポーネント。key を変えると作り直され、マウント時にもう一度判定する。
 * ログには Provider のマウントからの経過を出す（再チェックの結果でもマウントからの時間になる。
 * v1 と比べる計測は src/Measure.tsx）
 */
const ProviderHost = ({
  source,
  scenario,
  lang,
  icon,
  custom,
  color,
  ui,
  onLog,
  children,
}: HostProps) => {
  const [mountedAt] = useState(() => performance.now());
  const getters = useMemo(
    () => gettersFor(source, scenario),
    [source, scenario]
  );
  const elapsed = () => Math.round(performance.now() - mountedAt);

  return (
    <StoreVersionProvider
      getLatestVersion={getters.getLatestVersion}
      getMinimumVersion={getters.getMinimumVersion}
      // texts を変えると表示中のモーダルにもすぐ反映される
      texts={lang === 'ja' ? ja : undefined}
      icon={icon ? ICON : undefined}
      components={custom ? CUSTOM_COMPONENTS : undefined}
      // ボタンの塗りと「あとで」の文字の色。ライト / ダークで変えたいときは useColorScheme() で分けた値を渡す
      primaryColor={color === 'rose' ? ROSE : undefined}
      ui={ui}
      recheckOnForeground
      onResult={(result: StoreVersionCheckResult) => {
        onLog(
          `onResult (${elapsed()} ms after mount): ${result.local} → ${result.remote ?? '-'} result=${result.result ?? '-'} action=${result.action}`
        );
      }}
      onError={(error: StoreVersionError) => {
        onLog(
          `onError (${elapsed()} ms after mount): ${error.code} ${error.message}`
        );
      }}
    >
      {children}
    </StoreVersionProvider>
  );
};

export default function App() {
  const palette = usePalette();
  const [source, setSource] = useState<Source>('api');
  const [scenario, setScenario] = useState<MockScenario>('warning');
  const [lang, setLang] = useState<Lang>('en');
  const [icon, setIcon] = useState(false);
  const [custom, setCustom] = useState(false);
  const [color, setColor] = useState<'default' | 'rose'>('default');
  const [ui, setUi] = useState(true);
  const [run, setRun] = useState(0);
  const [measure, setMeasure] = useState(0);
  const [log, setLog] = useState<{ id: number; line: string }[]>([]);
  const nextId = useRef(0);

  // URL で開かれたら、クエリの設定を当てて Provider を作り直す（判定し直す）。measure=on だけなら作り直さずに計測を始める
  useEffect(() => {
    const apply = (url: string | null | undefined) => {
      if (!url?.includes('?')) {
        return;
      }
      const params = parseQuery(url);
      if (params.measure === 'on') {
        setMeasure((n) => n + 1);
      }
      const settings = [
        'source',
        'scenario',
        'lang',
        'icon',
        'custom',
        'color',
        'ui',
      ];
      if (!settings.some((key) => key in params)) {
        return;
      }
      const nextSource = pick(SOURCES, params.source);
      const nextScenario = pick(SCENARIOS, params.scenario);
      const nextLang = pick(LANGS, params.lang);
      const onOff = (value: string | undefined) =>
        pick(ON_OFF, value) === undefined ? undefined : value === 'on';
      if (nextScenario && !nextSource) {
        setSource('api');
      }
      if (nextSource) setSource(nextSource);
      if (nextScenario) setScenario(nextScenario);
      if (nextLang) setLang(nextLang);
      const nextIcon = onOff(params.icon);
      const nextCustom = onOff(params.custom);
      const nextUi = onOff(params.ui);
      if (nextIcon !== undefined) setIcon(nextIcon);
      if (nextCustom !== undefined) setCustom(nextCustom);
      if (nextUi !== undefined) setUi(nextUi);
      const nextColor = pick(COLORS, params.color);
      if (nextColor) setColor(nextColor);
      setRun((n) => n + 1);
    };
    if (!launch.__rnsvInitialUrlApplied) {
      launch.__rnsvInitialUrlApplied = true;
      Linking.getInitialURL().then(apply, () => {});
    }
    const subscription = Linking.addEventListener('url', ({ url }) =>
      apply(url)
    );
    return () => subscription.remove();
  }, []);

  const onLog = useCallback((line: string) => {
    // 記録用にログにも出す（npx expo start の端末や Xcode / logcat で見られる）
    console.log(`[rnsv] ${line}`);
    const id = nextId.current;
    nextId.current += 1;
    setLog((lines) => [{ id, line }, ...lines].slice(0, MAX_LOG));
  }, []);

  return (
    <ScrollView
      style={{ backgroundColor: palette.appBg }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <StatusBar style="auto" />
      <ProviderHost
        // 取得元を変えたら Provider を作り直して判定し直す（getter を変えただけでは再取得しない）
        key={`${source}-${scenario}-${run}`}
        source={source}
        scenario={scenario}
        lang={lang}
        icon={icon}
        custom={custom}
        color={color}
        ui={ui}
        onLog={onLog}
      >
        <SettingsScreen lang={lang} />

        <Card>
          <View style={styles.controls}>
            <Segmented
              label="Source"
              options={SOURCES}
              value={source}
              onChange={setSource}
            />
            {source === 'api' ? (
              <Segmented
                label="Scenario"
                options={SCENARIOS}
                value={scenario}
                onChange={setScenario}
              />
            ) : null}
            <Segmented
              label="Texts"
              options={LANGS}
              value={lang}
              onChange={setLang}
            />
            <Segmented
              label="Icon"
              options={ON_OFF}
              value={icon ? 'on' : 'off'}
              onChange={(value) => setIcon(value === 'on')}
            />
            <Segmented
              label="Custom components"
              options={ON_OFF}
              value={custom ? 'on' : 'off'}
              onChange={(value) => setCustom(value === 'on')}
            />
            <Segmented
              label="Button color (primaryColor)"
              options={COLORS}
              value={color}
              onChange={setColor}
            />
            <Segmented
              label="Default UI (ui)"
              options={ON_OFF}
              value={ui ? 'on' : 'off'}
              onChange={(value) => setUi(value === 'on')}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setRun((n) => n + 1)}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: palette.primary,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={styles.buttonText}>Check again (remount)</Text>
            </Pressable>
            <Text style={[styles.note, { color: palette.sub }]}>
              Force can't be closed. Reload the app (press r in the Expo
              terminal) to come back here. If you opened it with a URL, send
              ?scenario=none instead.
            </Text>
          </View>
        </Card>

        <Card>
          <View style={styles.log}>
            <Text style={[styles.controlLabel, { color: palette.text }]}>
              Log
            </Text>
            {log.length === 0 ? (
              <Text style={[styles.logLine, { color: palette.sub }]}>-</Text>
            ) : (
              log.map(({ id, line }) => (
                <Text key={id} style={[styles.logLine, { color: palette.sub }]}>
                  {line}
                </Text>
              ))
            )}
          </View>
        </Card>
      </ProviderHost>

      {/* 計測は Provider の外に置く（作り直しで計測が消えたり、もう一度始まったりしないように） */}
      <MeasurePanel trigger={measure} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // 余白は Settings のデザイン（上 56 / 左右 16 / 下 24、要素の間 20）。Android は edge-to-edge で
  // ナビゲーションバー（3 ボタンで 48dp）の下まで描かれるので、下を足す
  content: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'android' ? 64 : 24,
    gap: 20,
  },
  controls: {
    padding: 16,
    gap: 14,
  },
  control: {
    gap: 6,
  },
  controlLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  segments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  segment: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 14,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  note: {
    fontSize: 12,
    lineHeight: 16,
  },
  log: {
    padding: 16,
    gap: 4,
  },
  logLine: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
});
