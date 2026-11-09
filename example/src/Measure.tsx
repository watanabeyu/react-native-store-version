// 計測（メンテナー向け）: v1 と v2 の checkVersion() を、公開中の同じアプリに対して交互に 5 回ずつ呼び、
// 判定完了までの時間を比べる。v2 の checkVersion() は v2 の取得の仕組み（request / fetchers）の上で動くので、
// 取得の速さの比較になる。Provider のマウントから onResult / onError までの時間は App の画面に出る
// v1 は 1.4.1 を使う（1.4.2 と src は同じ。1.4.2 は公開から間もなく、pnpm-workspace.yaml の minimumReleaseAge で入れられなかった）
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { checkVersion as checkVersionV2 } from 'react-native-store-version';
import checkVersionV1 from 'react-native-store-version-v1';
import { Card, usePalette } from './SettingsScreen';

// 公開中のアプリ（GitHub）。version は比較に使うだけなので何でもよい
const TARGET = {
  version: '1.0.0',
  iosStoreURL: 'https://apps.apple.com/jp/app/github/id1477376905',
  androidStoreURL:
    'https://play.google.com/store/apps/details?id=com.github.android',
};

const RUNS = 5;

type Sample = { v1: number[]; v2: number[]; errors: string[] };

const median = (values: number[]) => {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const time = async (run: () => Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await run();
  return performance.now() - start;
};

const measure = async (): Promise<Sample> => {
  const sample: Sample = { v1: [], v2: [], errors: [] };
  // 順番の影響（接続の使い回しなど）を減らすため、v1 と v2 を交互に呼ぶ
  for (let i = 0; i < RUNS; i += 1) {
    for (const [name, run] of [
      ['v1', () => checkVersionV1(TARGET)],
      ['v2', () => checkVersionV2(TARGET)],
    ] as const) {
      try {
        sample[name].push(await time(run));
      } catch (error) {
        sample.errors.push(`#${i + 1} ${name}: ${String(error)}`);
      }
    }
  }
  return sample;
};

const format = (values: number[]) =>
  values.length === 0
    ? '-'
    : `median ${Math.round(median(values))} ms (${values.map((v) => Math.round(v)).join(', ')})`;

/** `trigger` が増えたら計測を始める（App が URL の measure=on で増やす） */
export const MeasurePanel = ({ trigger }: { trigger: number }) => {
  const palette = usePalette();
  const [running, setRunning] = useState(false);
  const [sample, setSample] = useState<Sample | null>(null);

  const runningRef = useRef(false);
  const start = async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setSample(null);
    const result = await measure();
    // 記録用にログにも出す
    console.log(`[rnsv-measure] checkVersion ${JSON.stringify(result)}`);
    setSample(result);
    setRunning(false);
    runningRef.current = false;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger が変わったときだけ始める（start は描画ごとに作り直される）
  useEffect(() => {
    if (trigger > 0) {
      void start();
    }
  }, [trigger]);

  return (
    <Card>
      <View style={styles.body}>
        <Text style={[styles.label, { color: palette.text }]}>
          checkVersion(): v1.4.1 vs v2 ({RUNS}×)
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={running}
          onPress={() => {
            void start();
          }}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: palette.primary,
              opacity: running ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={styles.buttonText}>
            {running ? 'Measuring…' : 'Measure'}
          </Text>
        </Pressable>
        {sample ? (
          <View style={styles.result}>
            <Text style={[styles.value, { color: palette.sub }]}>
              v1 {format(sample.v1)}
            </Text>
            <Text style={[styles.value, { color: palette.sub }]}>
              v2 {format(sample.v2)}
            </Text>
            {sample.errors.map((error) => (
              <Text key={error} style={[styles.value, { color: '#DC2626' }]}>
                {error}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  body: {
    padding: 16,
    gap: 12,
  },
  label: {
    fontSize: 16,
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
  result: {
    gap: 4,
  },
  value: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
