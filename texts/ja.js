// `react-native-store-version/texts/ja` の入口。dist/texts/ja を再 export するだけ。
// RN 0.73〜0.78 の Metro は既定で package.json の `exports` を見ないので、パッケージ直下のこのファイルで解決させる
export { default } from '../dist/texts/ja.js';
