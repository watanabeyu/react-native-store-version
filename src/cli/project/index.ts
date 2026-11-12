// アプリの構成（Expo の設定・iOS / Android のネイティブのプロジェクト）を 1 回だけ読む。C2 / C3 / C4 / C8 が共有する
// （`--ignore C2` でも C3 / C4 / C8 は ID と版を使うので、読むのは C2 の結果を出すかどうかと別にしている）
import { type AndroidProject, readAndroidProject } from './android.ts';
import { type ExpoProject, readExpoProject } from './expo.ts';
import { type IosProject, readIosProject } from './ios.ts';

/** アプリの構成。それぞれ、無い（Expo でない・`ios/` が無い・`android/` が無い）なら null */
export type ProjectInfo = {
  expo: ExpoProject | null;
  ios: IosProject | null;
  android: AndroidProject | null;
};

export const readProject = (cwd: string): ProjectInfo => ({
  expo: readExpoProject(cwd),
  ios: readIosProject(cwd),
  android: readAndroidProject(cwd),
});
