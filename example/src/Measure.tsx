// 計測（メンテナー向け。成功指標「起動から判定完了まで」）: 公開中の同じアプリ（GitHub）について、
// v1 の checkVersion() の所要時間と、v2 の Provider のマウントから onResult / onError までの時間を交互に 5 回ずつ測る。
// v1 は 1.4.1 を使う（1.4.2 と src は同じ。1.4.2 は公開から間もなく、pnpm-workspace.yaml の minimumReleaseAge で入れられなかった）
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StoreVersionProvider } from 'react-native-store-version';
import checkVersionV1 from 'react-native-store-version-v1';
import { Card, usePalette } from './SettingsScreen';

// v1 は App Store / Play の URL が要る。v2 の Provider は bundleId / packageName で問い合わせる（通常は自動取得するので
// 渡さない。ここでは計測のために example 自身ではなく公開中のアプリを指す）。v2 ではストアを開く URL は指定できない（D24）
const TARGET = {
  version: '1.0.0',
  country: 'jp',
  iosStoreURL: 'https://apps.apple.com/jp/app/github/id1477376905',
  androidStoreURL:
    'https://play.google.com/store/apps/details?id=com.github.android',
  bundleId: 'com.github.stormbreaker.prod',
  packageName: 'com.github.android',
};

const RUNS = 5;

// v2 の 1 回の期限。skipped（Expo Go など）では onResult も onError も来ないので、これで打ち切る
// （Provider の既定のタイムアウト 10 秒より長くする）。計測中はアプリを前面のままにする（バックグラウンドでは取り直しになる）
const V2_DEADLINE_MS = 15000;

type Which = 'v1' | 'v2';
type Sample = Record<Which, number[]> & { errors: string[] };
type Outcome = [ms: number, error: string | null];

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

const format = (values: number[]) =>
  values.length === 0
    ? '-'
    : `median ${Math.round(median(values))} ms (${values.map((v) => Math.round(v)).join(', ')})`;

/** v2: Provider をマウントし、マウントから最初の onResult / onError までの時間を返す（UI は出さない） */
const Probe = ({
  onDone,
}: {
  onDone: (ms: number, error: string | null) => void;
}) => {
  const [mountedAt] = useState(() => performance.now());
  const done = useRef(false);
  const finish = (error: string | null) => {
    if (!done.current) {
      done.current = true;
      onDone(performance.now() - mountedAt, error);
    }
  };
  return (
    <StoreVersionProvider
      version={TARGET.version}
      country={TARGET.country}
      bundleId={TARGET.bundleId}
      packageName={TARGET.packageName}
      ui={false}
      onResult={() => finish(null)}
      onError={(error) => finish(`${error.code} ${error.message}`)}
    />
  );
};

const runV1 = async (): Promise<Outcome> => {
  const start = performance.now();
  try {
    await checkVersionV1(TARGET);
    return [performance.now() - start, null];
  } catch (error) {
    return [performance.now() - start, String(error)];
  }
};

/** `trigger` が増えたら計測を始める（App が URL の measure=on で増やす） */
export const MeasurePanel = ({ trigger }: { trigger: number }) => {
  const palette = usePalette();
  const [running, setRunning] = useState(false);
  const [sample, setSample] = useState<Sample | null>(null);
  // v2 の 1 回分の Probe（key を変えて毎回マウントし直す）と、その完了を待つ関数
  const [probe, setProbe] = useState<number | null>(null);
  const settle = useRef<((outcome: Outcome) => void) | null>(null);
  // Probe の key の通し番号（消す更新と次を出す更新がまとめて描画されても、必ずマウントし直すため）
  const probeKey = useRef(0);
  const runningRef = useRef(false);

  const runV2 = () =>
    new Promise<Outcome>((resolve) => {
      const deadline = setTimeout(() => {
        settle.current?.([V2_DEADLINE_MS, 'no onResult / onError (skipped?)']);
      }, V2_DEADLINE_MS);
      settle.current = (outcome) => {
        clearTimeout(deadline);
        settle.current = null;
        setProbe(null);
        resolve(outcome);
      };
      probeKey.current += 1;
      setProbe(probeKey.current);
    });

  const start = async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setSample(null);
    const result: Sample = { v1: [], v2: [], errors: [] };
    const run = { v1: runV1, v2: runV2 };
    // 最初の 1 回ずつは捨てる（DNS / TLS / 接続を作るコストを片方だけに乗せないため）
    await runV1();
    await runV2();
    for (let i = 0; i < RUNS; i += 1) {
      // 順番の影響を減らすため、v1 → v2 と v2 → v1 を交互にする
      const order: Which[] = i % 2 === 0 ? ['v1', 'v2'] : ['v2', 'v1'];
      for (const which of order) {
        const [ms, error] = await run[which]();
        if (error === null) {
          result[which].push(ms);
        } else {
          result.errors.push(`#${i + 1} ${which}: ${error}`);
        }
      }
    }
    // 記録用にログにも出す
    console.log(
      `[rnsv-measure] v1-checkVersion-vs-v2-provider ${JSON.stringify(result)}`
    );
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
          v1.4.1 checkVersion() vs v2 Provider ({RUNS}×)
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
        {probe === null ? null : (
          <Probe
            key={probe}
            onDone={(ms, error) => settle.current?.([ms, error])}
          />
        )}
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
