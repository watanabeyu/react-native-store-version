// optional peerDependencies（expo-application / react-native-device-info）の有無を切り替えるヘルパー。
// どちらも devDependencies に入れていない（runtime の依存を増やさない方針で、テストのためだけに入れる理由も無い。
// package.json の optional peer としては宣言しているが、pnpm-workspace.yaml の autoInstallPeers: false で開発環境には入らない）ので、
// 「ある」は jest.doMock(..., { virtual: true }) で作り、「無い」は factory から Metro / Node と同じ
// `Cannot find module` を投げて require を失敗させる（D39: metro-runtime は無い peer の require で throw する）。
//
// Jest は一度 require に成功したモジュールを登録簿に残すので、切り替えのたびに jest.resetModules() で登録簿を空にする。
// src/detect.ts は呼ばれるたびにリテラル文字列の require をするので、テストが先頭で import した detect のままで切り替わる。
// resetModules で Platform のモックも作り直されるが、__helpers__/platform.ts は状態を globalThis に持つので setPlatform はそのまま効く。
//
// react は 1 つに固定する（3b）: react-native の index.js はコンポーネントを getter で遅延 require するので、resetModules の後に
// Provider のデフォルト UI が描く Pressable / Modal などは新しい登録簿から読まれ、そのまま新しい react を require してしまう。
// テストのツリーは元の react で描画しているので、2 つ目の react ができるとその hooks が「Invalid hook call」になる。
// ここで読み込んだ react（テストの描画と同じインスタンス）を resetModules の後の登録簿にも返す
import * as React from 'react';

export type ExpoApplicationMock = {
  nativeApplicationVersion?: string | null;
  applicationId?: string | null;
};

export type DeviceInfoMock = {
  getVersion?: () => string;
  getBundleId?: () => string;
};

export type OptionalModules = {
  /** 省略 / null は「入っていない」 */
  'expo-application'?:
    | ExpoApplicationMock
    | { default: ExpoApplicationMock }
    | null;
  /** 省略 / null は「入っていない」。`{ default: ... }` で default export の形にもできる */
  'react-native-device-info'?:
    | DeviceInfoMock
    | { default: DeviceInfoMock }
    | null;
};

const notFound = (name: string) => {
  const error = new Error(`Cannot find module '${name}'`) as Error & {
    code: string;
  };
  error.code = 'MODULE_NOT_FOUND';
  return error;
};

/** optional peer の有無と中身を決める。指定しなかったものは「入っていない」 */
export const setOptionalModules = (modules: OptionalModules = {}) => {
  jest.resetModules();
  jest.doMock('react', () => React);
  for (const name of [
    'expo-application',
    'react-native-device-info',
  ] as const) {
    const value = modules[name];
    jest.doMock(
      name,
      () => {
        if (value == null) {
          throw notFound(name);
        }
        return value;
      },
      { virtual: true }
    );
  }
};
