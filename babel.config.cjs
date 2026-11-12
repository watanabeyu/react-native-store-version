module.exports = {
  // enableBabelRuntime: false でヘルパーをインライン化する。@babel/runtime は devDependencies に無く
  // （pnpm の NODE_PATH で偶然解決されるだけの phantom dependency になる）ため、依存を増やさずに済ませる
  presets: [
    ['module:@react-native/babel-preset', { enableBabelRuntime: false }],
  ],
};
