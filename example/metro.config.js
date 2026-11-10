// example は pnpm workspace の 1 つで、ライブラリ本体（リポジトリのルート）を workspace:* で参照する。
// ルートの node_modules にはライブラリのテスト用の react / react-native があり、版が example と違うことがある。
// ライブラリ（と計測用の v1）から読まれる react / react-native / optional peer は、example 側のものに寄せて 1 つのコピーにする
// （2 つあると "Invalid hook call" になる）。
// SDK 58 では Expo の autolinkingModuleResolution（monorepo では既定で有効）も react / react-native と autolink される
// モジュールを example 側に寄せるので、これは古い SDK やその機能を切ったときのための保険。app.json で
// experiments.autolinkingModuleResolution を false にして書き出し、これがあれば 1 コピー、無ければ react 19.3.1 側の
// コピーも入ることを確かめた（2026-11-09）。dist が使う @babel/runtime は Expo の fallback の解決で見つかる
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// ルートの dist/ と texts/ を変更の監視とバンドルの対象にする
config.watchFolders = [...new Set([...(config.watchFolders ?? []), repoRoot])];

const SHARED = [
  'react',
  'react-native',
  'expo-application',
  'react-native-device-info',
];
const isShared = (name) =>
  SHARED.some((shared) => name === shared || name.startsWith(`${shared}/`));

// ライブラリ本体（ルートの dist/）と、計測用の v1（node_modules/.pnpm の中の react-native-store-version@1.x）
const isLibrary = (origin) =>
  origin.startsWith(path.join(repoRoot, 'dist') + path.sep) ||
  /[\\/]react-native-store-version@1\.[^\\/]*[\\/]/.test(origin);

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveRequest ?? context.resolveRequest;
  if (isShared(moduleName) && isLibrary(context.originModulePath)) {
    return resolve(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
