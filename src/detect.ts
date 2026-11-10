// local version / ID の自動取得と、何もしない環境の判定
import { Platform } from 'react-native';

import { StoreVersionError } from './errors.ts';

// optional peerDependencies は try/catch で囲んだリテラル文字列の require で読む。
// 動的な require(name) や import() にすると Metro がバンドルできない。無い peer は Metro では依存表が null になり、
// require が `Cannot find module` を throw するので catch に入る。RN 側のビルド（tsconfig.build.json）には Node の型を入れないので、ここで型だけを付ける
declare const require: (id: string) => unknown;

type ExpoApplication = {
  nativeApplicationVersion?: unknown;
  applicationId?: unknown;
};

type DeviceInfo = {
  getVersion?: unknown;
  getBundleId?: unknown;
};

/** `default` export の形（CJS / ESM の相互運用でどちらにもなりうる）でも、名前付きの形でも同じものを取り出す */
const pick = <T extends object>(mod: unknown, key: keyof T): unknown => {
  if (typeof mod !== 'object' || mod === null) {
    return undefined;
  }
  const value = (mod as T)[key];
  if (value !== undefined) {
    return value;
  }
  const fallback = (mod as { default?: unknown }).default;
  return typeof fallback === 'object' && fallback !== null
    ? (fallback as T)[key]
    : undefined;
};

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const fromExpoApplication = (key: keyof ExpoApplication): string | null => {
  try {
    return nonEmpty(pick<ExpoApplication>(require('expo-application'), key));
  } catch {
    return null;
  }
};

const fromDeviceInfo = (key: keyof DeviceInfo): string | null => {
  try {
    const fn = pick<DeviceInfo>(require('react-native-device-info'), key);
    // ネイティブモジュールが無い（Expo Go など）と呼び出しで throw するので、ここも catch に入れる
    return typeof fn === 'function' ? nonEmpty(fn()) : null;
  } catch {
    return null;
  }
};

/**
 * ネイティブのバージョン（expo-application → react-native-device-info の順）。取れなければ null。
 * v1 互換の checkVersion は version と ID を別々に省略できるので、{@link detectApp} を通さずにこれを直接使う
 * （パッケージの入口からは export しない）
 */
export const nativeVersion = (): string | null =>
  fromExpoApplication('nativeApplicationVersion') ??
  fromDeviceInfo('getVersion');

/**
 * ネイティブの ID（bundleId / package name。expo-application → react-native-device-info の順）。取れなければ null。
 * checkVersion も直接使う（{@link nativeVersion} と同じ理由）
 */
export const nativeAppId = (): string | null =>
  fromExpoApplication('applicationId') ?? fromDeviceInfo('getBundleId');

/**
 * Expo Go の applicationId（Expo Go 自体のストア版と比べてしまうのを防ぐ。expo-constants には依存しない）。
 * iOS の bundle ID は `host.exp.Exponent`（E が大文字。@expo/cli の EXPO_GO_BUNDLE_IDENTIFIER）、
 * Android の package name は `host.exp.exponent`
 */
export const EXPO_GO_APPLICATION_IDS: readonly string[] = Object.freeze([
  'host.exp.Exponent',
  'host.exp.exponent',
]);

/**
 * 判定をしない理由。
 * - `web`: `Platform.OS === 'web'`（`applicationId` などが取れない）
 * - `unsupported-platform`: ios / android / web 以外（react-native-windows / macOS など。ストアの版と比べる意味が無い）
 * - `expo-go`: Expo Go の中で動いている
 */
export type SkipReason = 'web' | 'unsupported-platform' | 'expo-go';

/**
 * 判定をしない環境なら、その理由を返す。判定する環境なら null。
 * Expo Go はネイティブの ID（expo-application / react-native-device-info）で見る（明示的に渡された ID では見ない）
 */
export const getSkipReason = (os: string = Platform.OS): SkipReason | null => {
  if (os === 'web') {
    return 'web';
  }
  if (os !== 'ios' && os !== 'android') {
    return 'unsupported-platform';
  }
  const appId = nativeAppId();
  if (appId !== null && EXPO_GO_APPLICATION_IDS.includes(appId)) {
    return 'expo-go';
  }
  return null;
};

/** 自動取得の代わりに明示的に渡す値（渡した値が最優先） */
export type DetectParams = {
  /**
   * アプリのバージョン。必ずネイティブのバージョン（iOS の `CFBundleShortVersionString` / Android の `versionName`）を渡す。
   * `Constants.expoConfig.version` や `package.json` の値は JS バンドルに含まれ、OTA 更新で変わってしまう
   * （ネイティブは古いのに「更新済み」と誤判定し、force が出なくなる）ので使わないこと。
   * 省略すると expo-application の `nativeApplicationVersion` → react-native-device-info の `getVersion()` の順に取る
   */
  version?: string | null;
  /** iOS の bundleId。省略すると expo-application の `applicationId` → react-native-device-info の `getBundleId()` の順に取る */
  bundleId?: string | null;
  /** Android の package name。省略すると expo-application の `applicationId` → react-native-device-info の `getBundleId()` の順に取る */
  packageName?: string | null;
};

/** {@link detectApp} の結果 */
export type DetectedApp = {
  platform: 'ios' | 'android';
  /** ネイティブのバージョン */
  version: string;
  /** iOS は bundleId、Android は package name */
  appId: string;
};

const INSTALL_HINT =
  'install expo-application (Expo) or react-native-device-info (bare React Native)';

/**
 * local version と ID を求める。順に試す: 1. 明示的に渡された値 2. expo-application 3. react-native-device-info。
 * どれでも取れなければ、何を入れればよいかを書いた `LOCAL_VERSION_UNAVAILABLE` を投げる
 */
export const detectApp = (
  platform: 'ios' | 'android',
  params: DetectParams = {}
): DetectedApp => {
  const version = nonEmpty(params.version) ?? nativeVersion();
  if (version === null) {
    throw new StoreVersionError(
      'LOCAL_VERSION_UNAVAILABLE',
      `could not get the app version: ${INSTALL_HINT}, or pass \`version\` (the native version: ${platform === 'ios' ? 'CFBundleShortVersionString' : 'versionName'}. Do not use Constants.expoConfig.version or package.json, which OTA updates change)`
    );
  }
  const idName = platform === 'ios' ? 'bundleId' : 'packageName';
  const appId = nonEmpty(params[idName]) ?? nativeAppId();
  if (appId === null) {
    throw new StoreVersionError(
      'LOCAL_VERSION_UNAVAILABLE',
      `could not get the app ${platform === 'ios' ? 'bundle ID' : 'package name'}: ${INSTALL_HINT}, or pass \`${idName}\``
    );
  }
  return { platform, version, appId };
};

/** {@link detect} の結果。判定しない環境なら `skipped` に理由が入る */
export type DetectResult =
  | { skipped: SkipReason }
  | ({ skipped: null } & DetectedApp);

/**
 * `Platform.OS` から、判定しない環境か（{@link getSkipReason}）を見て、判定する環境なら local version と ID を求める
 * （{@link detectApp}）。取れなければ `LOCAL_VERSION_UNAVAILABLE` を投げる
 */
export const detect = (params: DetectParams = {}): DetectResult => {
  const os = Platform.OS;
  const skipped = getSkipReason(os);
  if (skipped !== null) {
    return { skipped };
  }
  return { skipped: null, ...detectApp(os as 'ios' | 'android', params) };
};
