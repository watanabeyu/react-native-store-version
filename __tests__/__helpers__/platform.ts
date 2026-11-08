// react-native の Platform を差し替えるヘルパー。
// jest.mock は babel-plugin-jest-hoist でファイル先頭に巻き上げられるのは test ファイル内だけなので、
// test ファイルの先頭で次のように使う（factory の中で require する）:
//
//   jest.mock('react-native/Libraries/Utilities/Platform', () =>
//     require('./__helpers__/platform').platformModule
//   );
//
// react-native の index.js は `require('./Libraries/Utilities/Platform').default` を読むので、default を持たせる。
// テストごとの切り替えは setPlatform('ios' | 'android')。

type OS = 'ios' | 'android';

const platform = {
  OS: 'ios' as OS,
  Version: 0,
  select: <T>(spec: { ios?: T; android?: T; default?: T }): T | undefined =>
    spec[platform.OS] ?? spec.default,
};

export const platformModule = { __esModule: true, default: platform };

export const setPlatform = (os: OS) => {
  platform.OS = os;
};
