// C2: iOS の bundleId / Android の package が特定できるか（spec 9.3）。特定した ID は C3（ストア）と C8（Android か）が使う
import type { Lookup } from '../project/files.ts';
import type { ProjectInfo } from '../project/index.ts';
import type { CheckEntry } from '../result.ts';

/** {@link resolveIds} の結果。`entries` は C2 の結果の行（`--ignore C2` のときは出さず、ID だけを使う） */
export type ResolvedIds = {
  ios: string | null;
  android: string | null;
  entries: CheckEntry[];
};

type PlatformSpec = {
  name: string;
  /** ID の呼び名 */
  idName: string;
  /** ネイティブのディレクトリ */
  dir: string;
  /** Expo の設定のキー */
  expoKey: string;
};

const IOS: PlatformSpec = {
  name: 'iOS',
  idName: 'bundleId',
  dir: 'ios/',
  expoKey: 'ios.bundleIdentifier',
};

const ANDROID: PlatformSpec = {
  name: 'Android',
  idName: 'package',
  dir: 'android/',
  expoKey: 'android.package',
};

type Resolved =
  | { id: string; message: string; notes: string[] }
  | { id: null; reason: string; notes: string[] };

/**
 * 1 つのプラットフォームの ID を決める。ネイティブのディレクトリがあればその値（Expo の設定とずれていれば info）、
 * ネイティブから特定できなければ Expo の設定の値。ネイティブのディレクトリが無ければ（CNG・bare RN で片方だけなど）Expo の設定の値
 */
const resolvePlatform = (
  spec: PlatformSpec,
  project: ProjectInfo,
  expoValue: string | null,
  native: Lookup | null
): Resolved => {
  const { name, idName, dir, expoKey } = spec;
  const expoFile = project.expo?.config?.file;
  const fromExpo =
    expoValue !== null && expoFile !== undefined
      ? `${expoKey} in ${expoFile}`
      : null;

  if (native?.value != null) {
    const notes =
      fromExpo !== null && expoValue !== native.value
        ? [
            `the ${name} ${idName} differs between ${native.label} "${native.value}" (${native.file}) and ${expoKey} "${expoValue}" (${expoFile}); using the native one, "${native.value}"`,
          ]
        : [];
    return {
      id: native.value,
      message: `${name} ${idName} "${native.value}" (${native.label} in ${native.file})`,
      notes,
    };
  }
  if (native !== null) {
    // ネイティブのディレクトリはあるが、値が特定できない
    if (fromExpo !== null && expoValue !== null) {
      return {
        id: expoValue,
        message: `${name} ${idName} "${expoValue}" (${fromExpo})`,
        notes: [
          `could not determine the ${name} ${idName} from ${dir} (${native.reason}); using ${expoKey} "${expoValue}" (${expoFile})`,
        ],
      };
    }
    return { id: null, reason: native.reason, notes: [] };
  }
  if (fromExpo !== null && expoValue !== null) {
    return {
      id: expoValue,
      message: `${name} ${idName} "${expoValue}" (${fromExpo})`,
      notes: [],
    };
  }
  if (expoFile !== undefined) {
    return {
      id: null,
      reason: `${expoKey} is not set in ${expoFile} and there is no ${dir} directory`,
      notes: [],
    };
  }
  return {
    id: null,
    reason:
      project.expo === null
        ? `there is no ${dir} directory and expo is not installed`
        : `the Expo config could not be read and there is no ${dir} directory`,
    notes: [],
  };
};

/**
 * C2。両方のプラットフォームが特定できなければ error、片方だけなら、もう片方は info（C3 はそのプラットフォームを飛ばす）。
 * Expo の設定の評価の失敗・複数の .xcodeproj / アプリのターゲット・flavor の無視・Expo の設定とネイティブのずれは info で添える
 */
export const resolveIds = (project: ProjectInfo): ResolvedIds => {
  const config = project.expo?.config ?? null;
  const ios = resolvePlatform(
    IOS,
    project,
    config?.bundleIdentifier ?? null,
    project.ios?.bundleId ?? null
  );
  const android = resolvePlatform(
    ANDROID,
    project,
    config?.package ?? null,
    project.android?.packageName ?? null
  );

  const entries: CheckEntry[] = [];
  if (ios.id === null && android.id === null) {
    entries.push({
      id: 'C2',
      level: 'error',
      message: `could not determine either the iOS bundleId or the Android package. iOS: ${ios.reason}. Android: ${android.reason}. Check that --cwd is the app directory`,
    });
  } else {
    for (const [spec, resolved] of [
      [IOS, ios],
      [ANDROID, android],
    ] as const) {
      entries.push(
        resolved.id === null
          ? {
              id: 'C2',
              level: 'info',
              message: `could not determine the ${spec.name} ${spec.idName}: ${resolved.reason}. C3 skips ${spec.name}`,
            }
          : { id: 'C2', level: 'ok', message: resolved.message }
      );
    }
  }

  const notes = [
    ...(project.expo?.notes ?? []),
    ...(project.ios?.notes ?? []),
    ...ios.notes,
    ...(project.android?.notes ?? []),
    ...android.notes,
  ];
  for (const message of notes) {
    entries.push({ id: 'C2', level: 'info', message });
  }

  return { ios: ios.id, android: android.id, entries };
};
