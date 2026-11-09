// biome.json の overrides の noRestrictedImports（src の RN 側で Node の標準モジュールを止める。D56 ⑥）の回帰テストの入力
// （__tests__/biome-plugins/node-imports.test.ts が、一時ディレクトリの src/ と src/cli/ と __tests__/ に置いた写しを lint する）。
// 通常の lint の対象外（biome.json の files.includes で __tests__/__fixtures__ を外している）。tsc の型チェックには入るので、
// import は実在するものにしている。
// src/ に置いたときに診断が出るべき行の末尾に `// detect`、出てはいけない行に `// ok` を書く（テストはこの印から期待値を作る）。
// src/cli/ と __tests__/ に置いたときは、どの行にも出ない
import { readFileSync } from 'node:fs'; // detect
import { readFile } from 'node:fs/promises'; // detect
import type { Stats } from 'node:fs'; // detect
import 'node:process'; // detect
import { Platform } from 'react-native'; // ok
import { readFixture } from '../../__helpers__/fetch.ts'; // ok
export { join } from 'node:path'; // detect
export * from 'node:os'; // detect
export { createResponse } from '../../__helpers__/fetch.ts'; // ok

export const loadLater = () => import('node:child_process'); // detect
export const loadLocal = () => import('../../__helpers__/platform.ts'); // ok

export const used: Array<Stats | unknown> = [
  readFileSync,
  readFile,
  Platform,
  readFixture,
];
