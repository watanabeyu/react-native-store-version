// Android のネイティブのプロジェクト（`android/`）から package（C2）と版（C4）を読む。
// `android/app/build.gradle`（無ければ `build.gradle.kts`）の最初の `defaultConfig { … }` と `android { namespace … }` を見る
import { join } from 'node:path';

import {
  displayPath,
  isDirectory,
  isFile,
  type Lookup,
  readText,
} from './files.ts';
import {
  findBlock,
  findStatement,
  hasWord,
  maskGradle,
  type Range,
} from './gradle.ts';

/** `android/` から読んだ値。`notes` は C2 が info で出す注意（productFlavors / applicationIdSuffix を無視したこと） */
export type AndroidProject = {
  packageName: Lookup;
  version: Lookup;
  notes: string[];
};

const GRADLE_FILES = ['build.gradle', 'build.gradle.kts'];

/** `android/` が無ければ null（CNG）。読めない・特定できないものは {@link Lookup} の reason にする */
export const readAndroidProject = (cwd: string): AndroidProject | null => {
  const androidDir = join(cwd, 'android');
  if (!isDirectory(androidDir)) {
    return null;
  }
  const notes: string[] = [];
  const unknown = (reason: string): AndroidProject => ({
    packageName: { value: null, reason },
    version: { value: null, reason },
    notes,
  });

  const path = GRADLE_FILES.map((name) => join(androidDir, 'app', name)).find(
    isFile
  );
  if (path === undefined) {
    return unknown(
      'there is no android/app/build.gradle or android/app/build.gradle.kts'
    );
  }
  const file = displayPath(cwd, path);
  const source = readText(path);
  if (source === null) {
    return unknown(`could not read ${file}`);
  }
  const masked = maskGradle(source);
  const defaultConfig = findBlock(masked, 'defaultConfig');

  /** `range` の直下の `key` を読む。無ければ null */
  const statement = (key: string, range: Range | null): Lookup | null => {
    const found = range && findStatement(source, masked, key, range);
    if (!found) {
      return null;
    }
    if (found.literal === undefined) {
      return {
        value: null,
        reason: `${key} in ${file} is not a string literal (${found.expression})`,
      };
    }
    return { value: found.literal, label: key, file };
  };

  // applicationId が無ければ namespace（AGP は applicationId の既定に namespace を使う）。applicationId が変数なら
  // namespace と同じとは限らないので、namespace には戻らず「特定できない」にする
  const packageName = statement('applicationId', defaultConfig) ??
    statement('namespace', findBlock(masked, 'android')) ?? {
      value: null,
      reason: `there is no applicationId in defaultConfig or namespace in android { } of ${file}`,
    };

  const flavors = ['productFlavors', 'applicationIdSuffix'].filter((word) =>
    hasWord(masked, word)
  );
  if (flavors.length > 0) {
    notes.push(
      `${file} has ${flavors.join(' and ')}; ${flavors.length > 1 ? 'they are' : 'it is'} ignored, and the package without a flavor or suffix is used`
    );
  }

  const version = statement('versionName', defaultConfig) ?? {
    value: null,
    reason: `there is no versionName in defaultConfig of ${file}`,
  };

  return { packageName, version, notes };
};
