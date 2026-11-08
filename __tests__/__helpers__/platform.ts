// react-native の Platform を差し替えるヘルパー。
// jest.mock は babel-plugin-jest-hoist でファイル先頭に巻き上げられるのは test ファイル内だけなので、
// test ファイルの先頭で次のように使う（factory の中で require する）:
//
//   jest.mock('react-native/Libraries/Utilities/Platform', () =>
//     require('./__helpers__/platform').platformModule
//   );
//
// react-native の index.js は `require('./Libraries/Utilities/Platform').default` を読むので、default を持たせる。
// テストごとの切り替えは setPlatform('ios' | 'android' | 'web' | 'windows' | 'macos')。
//
// 状態は globalThis に 1 つだけ持つ。jest.resetModules()（__helpers__/modules.ts）の後は factory が走り直して
// このファイルも読み直されるが、テストが先頭で import した setPlatform と同じ状態を指し続けるようにするため
// （globalThis はテストファイルごとの環境なので、ファイルをまたいでは共有されない）

type OS = 'ios' | 'android' | 'web' | 'windows' | 'macos';

type PlatformState = {
  OS: OS;
  Version: number;
  select: <T>(spec: Partial<Record<OS | 'default', T>>) => T | undefined;
};

const holder = globalThis as { __rnsvPlatform?: PlatformState };

const createPlatform = (): PlatformState => {
  const state: PlatformState = {
    OS: 'ios',
    Version: 0,
    select: (spec) => spec[state.OS] ?? spec.default,
  };
  return state;
};

if (!holder.__rnsvPlatform) {
  holder.__rnsvPlatform = createPlatform();
}

const platform = holder.__rnsvPlatform;

export const platformModule = { __esModule: true, default: platform };

export const setPlatform = (os: OS) => {
  platform.OS = os;
};
