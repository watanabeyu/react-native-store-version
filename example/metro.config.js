// example は pnpm workspace の 1 つで、ライブラリ本体（リポジトリのルート）を workspace:* で参照する。
// ルートの node_modules にはライブラリのテスト用の react / react-native があり、版が example と違うことがある。
// ライブラリ（と計測用の v1）から読まれる react / react-native / optional peer は、example 側のものに寄せて 1 つのコピーにする
// （2 つあると "Invalid hook call" になる）
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
