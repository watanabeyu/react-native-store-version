// iOS のネイティブのプロジェクト（`ios/`）から bundleId（C2）と版（C4）を読む。
// `ios/*.xcodeproj/project.pbxproj` のアプリのターゲットの Release の build settings と、そのターゲットの Info.plist を見る
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  displayPath,
  hasVariable,
  isDirectory,
  type Lookup,
  readText,
} from './files.ts';
import {
  isDict,
  type PlistDict,
  type PlistValue,
  parsePlist,
} from './plist.ts';

/** `ios/` から読んだ値。`notes` は C2 が info で出す注意（複数の .xcodeproj・複数のアプリのターゲット） */
export type IosProject = {
  bundleId: Lookup;
  version: Lookup;
  notes: string[];
};

const APPLICATION = 'com.apple.product-type.application';

const str = (value: PlistValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

const listOfIds = (value: PlistValue | undefined): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

/** CocoaPods が作る Pods.xcodeproj はアプリのプロジェクトではない */
const findXcodeprojs = (iosDir: string): string[] => {
  try {
    return readdirSync(iosDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.endsWith('.xcodeproj') &&
          entry.name !== 'Pods.xcodeproj'
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

type AppTarget = { name: string; release: PlistDict | null };

/**
 * アプリのターゲット（`productType` がちょうど `com.apple.product-type.application` の PBXNativeTarget）を、
 * PBXProject の `targets` の順（Xcode のターゲット一覧の順）に返す。テスト（`bundle.unit-test` など）・extension
 * （`app-extension`）・旧来の watch アプリ（`application.watchapp2`）は productType が違うので入らない。Xcode 14 以降の
 * watchOS 単体のアプリは productType が同じなので、Release の `SDKROOT` が watchOS のものも除く
 */
const findAppTargets = (root: PlistDict): AppTarget[] => {
  const objects = isDict(root.objects) ? root.objects : null;
  if (objects === null) {
    throw new Error('no "objects" in the project');
  }
  const object = (id: string): PlistDict | null => {
    const value = objects[id];
    return isDict(value) ? value : null;
  };

  const rootObject = object(str(root.rootObject) ?? '');
  // rootObject が辿れない壊れ方でも、objects の並び（ID 順）でターゲットを探す
  const targetIds = rootObject
    ? listOfIds(rootObject.targets)
    : Object.keys(objects);

  const releaseOf = (target: PlistDict): PlistDict | null => {
    const list = object(str(target.buildConfigurationList) ?? '');
    for (const id of listOfIds(list?.buildConfigurations)) {
      const config = object(id);
      if (
        config !== null &&
        str(config.isa) === 'XCBuildConfiguration' &&
        str(config.name) === 'Release'
      ) {
        return isDict(config.buildSettings)
          ? config.buildSettings
          : Object.create(null);
      }
    }
    return null;
  };

  const targets: AppTarget[] = [];
  for (const id of targetIds) {
    const target = object(id);
    if (
      target === null ||
      str(target.isa) !== 'PBXNativeTarget' ||
      str(target.productType) !== APPLICATION
    ) {
      continue;
    }
    const release = releaseOf(target);
    if (/watch/i.test(str(release?.SDKROOT) ?? '')) {
      continue;
    }
    targets.push({ name: str(target.name) ?? id, release });
  }
  return targets;
};

/** Info.plist（XML）の `key` の文字列の値。無い・空・`$(…)` を含む（ビルド時に決まる）なら null */
const readLiteral = (plist: string | null, key: string): string | null => {
  const match =
    plist === null
      ? null
      : new RegExp(
          `<key>\\s*${key}\\s*</key>\\s*<string>([^<]*)</string>`
        ).exec(plist);
  const value = match ? match[1].trim() : '';
  return value === '' || hasVariable(value) ? null : value;
};

/**
 * ターゲットの Info.plist のパス。Release の `INFOPLIST_FILE`（`$(SRCROOT)` / `$(PROJECT_DIR)` は .xcodeproj のある
 * ディレクトリ）、無ければ `<ターゲット名>/Info.plist`（React Native / Expo のテンプレートの置き場所）。
 * ほかの変数を含んで場所が決まらなければ null
 */
const infoPlistPath = (
  projectDir: string,
  target: AppTarget
): string | null => {
  const setting = str(target.release?.INFOPLIST_FILE);
  if (setting === null || setting === '') {
    return join(projectDir, target.name, 'Info.plist');
  }
  const path = setting.replace(/^\$[({](SRCROOT|PROJECT_DIR)[)}]\/?/, '');
  if (hasVariable(path)) {
    return null;
  }
  return resolve(projectDir, path);
};

/** `ios/` が無ければ null（CNG）。読めない・特定できないものは {@link Lookup} の reason にする */
export const readIosProject = (cwd: string): IosProject | null => {
  const iosDir = join(cwd, 'ios');
  if (!isDirectory(iosDir)) {
    return null;
  }
  const notes: string[] = [];
  const unknown = (reason: string): IosProject => ({
    bundleId: { value: null, reason },
    version: { value: null, reason },
    notes,
  });

  const xcodeprojs = findXcodeprojs(iosDir);
  if (xcodeprojs.length === 0) {
    return unknown(
      'there is no .xcodeproj in ios/ (other than Pods.xcodeproj)'
    );
  }
  if (xcodeprojs.length > 1) {
    notes.push(
      `ios/ has ${xcodeprojs.length} .xcodeproj (${xcodeprojs.join(', ')}); using the first one, ios/${xcodeprojs[0]}`
    );
  }
  const pbxprojPath = join(iosDir, xcodeprojs[0], 'project.pbxproj');
  const pbxproj = displayPath(cwd, pbxprojPath);
  const text = readText(pbxprojPath);
  if (text === null) {
    return unknown(`could not read ${pbxproj}`);
  }

  let targets: AppTarget[];
  try {
    const root = parsePlist(text);
    if (!isDict(root)) {
      throw new Error('the root is not a dictionary');
    }
    targets = findAppTargets(root);
  } catch (error) {
    return unknown(
      `could not parse ${pbxproj}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const [target] = targets;
  if (target === undefined) {
    return unknown(`there is no application target in ${pbxproj}`);
  }
  if (targets.length > 1) {
    notes.push(
      `${pbxproj} has ${targets.length} application targets (${targets.map((t) => `"${t.name}"`).join(', ')}); using the first one, "${target.name}"`
    );
  }
  const { release } = target;
  if (release === null) {
    return unknown(
      `target "${target.name}" in ${pbxproj} has no Release build configuration`
    );
  }

  /** Release の build settings の値。無い・変数を含むなら reason */
  const setting = (key: string): Lookup => {
    const value = str(release[key]);
    if (value === null || value === '') {
      return {
        value: null,
        reason: `${key} is not set in the Release build settings of target "${target.name}" in ${pbxproj}`,
      };
    }
    if (hasVariable(value)) {
      return {
        value: null,
        reason: `${key} of target "${target.name}" (Release) in ${pbxproj} is "${value}", which depends on other build settings`,
      };
    }
    return { value, label: key, file: pbxproj };
  };

  // SRCROOT は .xcodeproj のあるディレクトリ（ios/）
  const plistPath = infoPlistPath(iosDir, target);
  const plist = plistPath === null ? null : readText(plistPath);
  const plistFile = plistPath === null ? '' : displayPath(cwd, plistPath);

  // bundleId・版とも、Info.plist の値がリテラルならそれ（Xcode はビルドの結果に Info.plist の値を入れる）、
  // `$(PRODUCT_BUNDLE_IDENTIFIER)` / `$(MARKETING_VERSION)` のような参照なら build settings の値
  let bundleId = setting('PRODUCT_BUNDLE_IDENTIFIER');
  const plistId = readLiteral(plist, 'CFBundleIdentifier');
  if (plistId !== null) {
    if (bundleId.value !== null && bundleId.value !== plistId) {
      notes.push(
        `${plistFile} has CFBundleIdentifier "${plistId}", but PRODUCT_BUNDLE_IDENTIFIER of target "${target.name}" (Release) in ${pbxproj} is "${bundleId.value}"; using the Info.plist one, "${plistId}"`
      );
    }
    bundleId = { value: plistId, label: 'CFBundleIdentifier', file: plistFile };
  }

  const short = readLiteral(plist, 'CFBundleShortVersionString');
  const version: Lookup =
    short === null
      ? setting('MARKETING_VERSION')
      : { value: short, label: 'CFBundleShortVersionString', file: plistFile };

  return { bundleId, version, notes };
};
