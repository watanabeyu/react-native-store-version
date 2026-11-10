/**
 * @jest-environment node
 */
// `check` のチェックの順番と --ignore、3 つの構成（Expo の CNG / Expo のネイティブあり / bare RN）の fixture での判定
// （fetch はモックして fixture を返す。実ストアにはアクセスしない）
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { runChecks } from '../../src/cli/check.ts';
import type { CheckEntry } from '../../src/cli/result.ts';
import { createResponse, readFixture } from '../__helpers__/fetch.ts';
import {
  createProject,
  FAKE_EXPO_CONFIG,
  installExpo,
  type Project,
} from '../__helpers__/project.ts';

/** App Store は itunes-lookup.json（1.283.0）、Google Play は playstore.html（1.283.0）を返す */
const mockStores = () =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    createResponse({
      body: readFixture(
        String(input).startsWith('https://itunes.apple.com/')
          ? 'store/itunes-lookup.json'
          : 'store/playstore.html'
      ),
    })
  );

const levels = (entries: CheckEntry[]) =>
  entries.map(({ id, level }) => `${id} ${level}`);

const ROLLOUT_NOTE =
  "If you use a staged rollout on Google Play, users outside the rollout cannot get the new version, so a force update from the store version can leave them unable to use the app. When Platform.OS === 'android', set major: 'warning' in the policy, or control force with getMinimumVersion. This is a simple text search and may be a false positive (a policy that already uses major: 'warning' only on Android still has 'force' in it); if so, suppress it with --ignore C8";

describe('runChecks', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject({
      'react-native-store-version': {
        name: 'react-native-store-version',
        version: '2.0.0',
      },
      'expo-application': { name: 'expo-application', version: '1.0.0' },
    });
  });

  afterEach(() => {
    project.remove();
  });

  const run = (ignore: string[] = []) =>
    runChecks({ cwd: project.dir, country: 'us', ignore: new Set(ignore) });

  it('runs C1, C2, C3, C4, C7 and C8 in this order', async () => {
    project.copyFixture('expo-native');
    installExpo(project);
    mockStores();
    const entries = await run();
    expect([...new Set(entries.map(({ id }) => id))]).toEqual([
      'C1',
      'C2',
      'C3',
      'C4',
      'C7',
      'C8',
    ]);
  });

  it('does not run the ignored checks', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const entries = await run(['C1', 'C7']);
    expect([...new Set(entries.map((e) => e.id))]).toEqual([
      'C2',
      'C3',
      'C4',
      'C8',
    ]);
    await expect(run(['C1', 'C2', 'C3', 'C4', 'C7', 'C8'])).resolves.toEqual(
      []
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not evaluate the Expo config when no check uses the project', async () => {
    project.copyFixture('expo-cng');
    // 読み込まれたら印のファイルを書く expo/config（例外は C2 の info に吸われて外から見えないので、副作用で確かめる）
    const marker = join(project.dir, 'evaluated');
    installExpo(
      project,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '');\n${FAKE_EXPO_CONFIG}`
    );
    await expect(run(['C2', 'C3', 'C4', 'C8'])).resolves.toEqual([
      expect.objectContaining({ id: 'C1', level: 'ok' }),
      expect.objectContaining({ id: 'C7', level: 'ok' }),
    ]);
    expect(existsSync(marker)).toBe(false);

    // 印が働くこと（どれかが構成を使えば評価される）
    await run(['C1', 'C2', 'C3', 'C7', 'C8']);
    expect(existsSync(marker)).toBe(true);
  });

  it('still uses the IDs from C2 for C3 and C8 when C2 is ignored', async () => {
    project.copyFixture('expo-cng');
    installExpo(project);
    const fetch = mockStores();
    const entries = await run(['C2']);
    expect(levels(entries)).toEqual([
      'C1 ok',
      'C3 ok',
      'C3 ok',
      'C4 skipped',
      'C7 ok',
      'C8 warning',
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  describe('Expo with Continuous Native Generation (expo-cng)', () => {
    beforeEach(() => {
      project.copyFixture('expo-cng');
    });

    it('reads both IDs from the evaluated app.config.js, skips C4, and warns C8 (no policy)', async () => {
      installExpo(project);
      const fetch = mockStores();
      const entries = await run(['C1', 'C7']);
      expect(entries).toEqual([
        {
          id: 'C2',
          level: 'ok',
          message:
            'iOS bundleId "com.example.cng" (ios.bundleIdentifier in app.config.js)',
        },
        {
          id: 'C2',
          level: 'ok',
          message:
            'Android package "com.example.cng" (android.package in app.config.js)',
        },
        {
          id: 'C3',
          level: 'ok',
          message:
            'bundleId "com.example.cng" is on the App Store (us) (version 1.283.0)',
        },
        {
          id: 'C3',
          level: 'ok',
          message:
            'package "com.example.cng" is on Google Play (version 1.283.0)',
        },
        {
          id: 'C4',
          level: 'skipped',
          message:
            'there is no ios/ or android/ directory (Continuous Native Generation), so there are no native versions to compare',
        },
        {
          id: 'C8',
          level: 'warning',
          message: `App.tsx: <StoreVersionProvider> has no policy prop (the default policy has major: 'force'), and getLatestVersion / getMinimumVersion is not used in the sources. ${ROLLOUT_NOTE}`,
        },
      ]);
      const urls = fetch.mock.calls.map(([input]) => String(input));
      expect(urls[0]).toContain('bundleId=com.example.cng&');
      expect(urls[1]).toBe(
        'https://play.google.com/store/apps/details?id=com.example.cng'
      );
    });

    it('falls back to app.json when getConfig fails (only the Android package is there)', async () => {
      installExpo(
        project,
        'exports.getConfig = () => { throw new SyntaxError("app.config.js: Unexpected token (3:4)\\n  1 | module.exports"); };'
      );
      const fetch = mockStores();
      const entries = await run(['C1', 'C4', 'C7', 'C8']);
      expect(entries).toEqual([
        {
          id: 'C2',
          level: 'info',
          message:
            'could not determine the iOS bundleId: ios.bundleIdentifier is not set in app.json and there is no ios/ directory. C3 skips iOS',
        },
        {
          id: 'C2',
          level: 'ok',
          message:
            'Android package "com.example.cng" (android.package in app.json)',
        },
        {
          id: 'C2',
          level: 'info',
          message:
            'could not evaluate the Expo config with expo/config (app.config.js: Unexpected token (3:4)); read app.json directly instead',
        },
        expect.objectContaining({ id: 'C3', level: 'ok' }),
      ]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('is a C2 error when neither ID can be determined, and C3 / C8 are skipped', async () => {
      installExpo(project);
      project.write(
        'app.config.js',
        'module.exports = ({ config }) => ({ name: config.name });'
      );
      const fetch = jest.spyOn(globalThis, 'fetch');
      const entries = await run(['C1', 'C7']);
      expect(entries).toEqual([
        {
          id: 'C2',
          level: 'error',
          message:
            'could not determine either the iOS bundleId or the Android package. iOS: ios.bundleIdentifier is not set in app.config.js and there is no ios/ directory. Android: android.package is not set in app.config.js and there is no android/ directory. Check that --cwd is the app directory',
        },
        {
          id: 'C3',
          level: 'skipped',
          message: 'no iOS bundleId or Android package to look up',
        },
        expect.objectContaining({ id: 'C4', level: 'skipped' }),
        {
          id: 'C8',
          level: 'skipped',
          message:
            'no Android package was determined, so the staged rollout note does not apply',
        },
      ]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('does not write the output of app.config.js to stdout (it would break --json)', async () => {
      installExpo(project);
      project.write(
        'app.config.js',
        `process.stdout.write('written from app.config.js\\n');
console.log('logged from app.config.js');
module.exports = ({ config }) => config;`
      );
      const stdout = jest.spyOn(process.stdout, 'write');
      const stderr = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      await run(['C1', 'C3', 'C7', 'C8']);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([text]) => String(text))).toEqual([
        'written from app.config.js\n',
        'logged from app.config.js\n',
      ]);
    });
  });

  describe('Expo with native directories (expo-native)', () => {
    beforeEach(() => {
      project.copyFixture('expo-native');
      installExpo(project);
    });

    it('reads the IDs from the native files, the versions match, and C8 is ok because getMinimumVersion is used', async () => {
      const entries = await run(['C1', 'C3', 'C7']);
      expect(entries).toEqual([
        {
          id: 'C2',
          level: 'ok',
          message:
            'iOS bundleId "com.example.native" (PRODUCT_BUNDLE_IDENTIFIER in ios/ExpoNative.xcodeproj/project.pbxproj)',
        },
        {
          id: 'C2',
          level: 'ok',
          message:
            'Android package "com.example.native" (applicationId in android/app/build.gradle)',
        },
        {
          id: 'C4',
          level: 'ok',
          message:
            'the versions match: iOS CFBundleShortVersionString 1.2.0 (ios/ExpoNative/Info.plist), Android versionName 1.2.0 (android/app/build.gradle), Expo version 1.2.0 (app.json)',
        },
        {
          id: 'C8',
          level: 'ok',
          message:
            'getLatestVersion / getMinimumVersion is used (App.tsx), so force updates do not depend only on the store version',
        },
      ]);
    });

    it('uses the native ID and notes it when the Expo config differs', async () => {
      project.write(
        'app.json',
        JSON.stringify({
          expo: {
            version: '1.2.0',
            ios: { bundleIdentifier: 'com.example.renamed' },
            android: { package: 'com.example.native' },
          },
        })
      );
      const entries = await run(['C1', 'C3', 'C4', 'C7', 'C8']);
      expect(entries).toEqual([
        {
          id: 'C2',
          level: 'ok',
          message:
            'iOS bundleId "com.example.native" (PRODUCT_BUNDLE_IDENTIFIER in ios/ExpoNative.xcodeproj/project.pbxproj)',
        },
        expect.objectContaining({ id: 'C2', level: 'ok' }),
        {
          id: 'C2',
          level: 'info',
          message:
            'the iOS bundleId differs between PRODUCT_BUNDLE_IDENTIFIER "com.example.native" (ios/ExpoNative.xcodeproj/project.pbxproj) and ios.bundleIdentifier "com.example.renamed" (app.json); using the native one, "com.example.native"',
        },
      ]);
    });

    it('warns about each pair of versions that differ', async () => {
      project.write(
        'app.json',
        JSON.stringify({
          expo: {
            version: '1.3.0',
            ios: { bundleIdentifier: 'com.example.native' },
            android: { package: 'com.example.native' },
          },
        })
      );
      const entries = await run(['C1', 'C2', 'C3', 'C7', 'C8']);
      expect(entries).toEqual([
        {
          id: 'C4',
          level: 'warning',
          message:
            'iOS CFBundleShortVersionString 1.2.0 (ios/ExpoNative/Info.plist) differs from Expo version 1.3.0 (app.json)',
        },
        {
          id: 'C4',
          level: 'warning',
          message:
            'Android versionName 1.2.0 (android/app/build.gradle) differs from Expo version 1.3.0 (app.json)',
        },
      ]);
    });
  });

  describe('bare React Native (bare-rn)', () => {
    beforeEach(() => {
      project.copyFixture('bare-rn');
    });

    it('does not compare the package.json version that getConfig fills in when expo is installed but app.json has no version', async () => {
      // bare RN に expo（Expo Modules）を入れただけのアプリ。getConfig は exp.version を package.json の 0.0.1 で埋める
      project.write(
        'package.json',
        JSON.stringify({ name: 'bare-app', version: '0.0.1', private: true })
      );
      installExpo(project);
      const entries = await run(['C1', 'C2', 'C3', 'C7', 'C8']);
      expect(entries).toEqual([
        {
          id: 'C4',
          level: 'ok',
          message:
            'the versions match: iOS MARKETING_VERSION 2.0.1 (ios/BareApp.xcodeproj/project.pbxproj), Android versionName 2.0.1 (android/app/build.gradle)',
        },
      ]);
    });

    it('reads the IDs from project.pbxproj and build.gradle, the versions match, and C8 warns about the policy with force', async () => {
      const fetch = mockStores();
      const entries = await run(['C1', 'C7']);
      expect(entries).toEqual([
        {
          id: 'C2',
          level: 'ok',
          message:
            'iOS bundleId "com.example.bare" (PRODUCT_BUNDLE_IDENTIFIER in ios/BareApp.xcodeproj/project.pbxproj)',
        },
        {
          id: 'C2',
          level: 'ok',
          message:
            'Android package "com.example.bare" (applicationId in android/app/build.gradle)',
        },
        expect.objectContaining({ id: 'C3', level: 'ok' }),
        expect.objectContaining({ id: 'C3', level: 'ok' }),
        {
          id: 'C4',
          level: 'ok',
          message:
            'the versions match: iOS MARKETING_VERSION 2.0.1 (ios/BareApp.xcodeproj/project.pbxproj), Android versionName 2.0.1 (android/app/build.gradle)',
        },
        {
          id: 'C8',
          level: 'warning',
          message: `src/App.jsx: <StoreVersionProvider> has 'force' in its policy, and getLatestVersion / getMinimumVersion is not used in the sources. ${ROLLOUT_NOTE}`,
        },
      ]);
      expect(String(fetch.mock.calls[0][0])).toContain(
        'bundleId=com.example.bare&'
      );
    });

    it('warns when the native versions differ', async () => {
      project.write(
        'android/app/build.gradle',
        'android {\n  defaultConfig {\n    applicationId "com.example.bare"\n    versionName "2.1.0"\n  }\n}\n'
      );
      const entries = await run(['C1', 'C2', 'C3', 'C7', 'C8']);
      expect(entries).toEqual([
        {
          id: 'C4',
          level: 'warning',
          message:
            'iOS MARKETING_VERSION 2.0.1 (ios/BareApp.xcodeproj/project.pbxproj) differs from Android versionName 2.1.0 (android/app/build.gradle)',
        },
      ]);
    });

    it('reports info for the platform that cannot be determined, and skips C8 without an Android package', async () => {
      project.write(
        'android/app/build.gradle',
        'android {\n  defaultConfig {\n    applicationId rootProject.ext.appId\n    versionName "2.0.1"\n  }\n}\n'
      );
      const fetch = mockStores();
      const entries = await run(['C1', 'C4', 'C7']);
      expect(entries).toEqual([
        expect.objectContaining({ id: 'C2', level: 'ok' }),
        {
          id: 'C2',
          level: 'info',
          message:
            'could not determine the Android package: applicationId in android/app/build.gradle is not a string literal (rootProject.ext.appId). C3 skips Android',
        },
        expect.objectContaining({ id: 'C3', level: 'ok' }),
        expect.objectContaining({ id: 'C8', level: 'skipped' }),
      ]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('is a C2 error when both native files have only variables', async () => {
      project.write(
        'android/app/build.gradle',
        'android {\n  defaultConfig {\n    applicationId appId\n  }\n}\n'
      );
      project.write(
        'ios/BareApp.xcodeproj/project.pbxproj',
        readFixture(
          'cli/bare-rn/ios/BareApp.xcodeproj/project.pbxproj'
        ).replace(
          /PRODUCT_BUNDLE_IDENTIFIER = "com\.example\.bare";/g,
          'PRODUCT_BUNDLE_IDENTIFIER = "$(APP_ID)";'
        )
      );
      const entries = await run(['C1', 'C3', 'C4', 'C7', 'C8']);
      expect(entries).toEqual([
        {
          id: 'C2',
          level: 'error',
          message:
            'could not determine either the iOS bundleId or the Android package. iOS: PRODUCT_BUNDLE_IDENTIFIER of target "BareApp" (Release) in ios/BareApp.xcodeproj/project.pbxproj is "$(APP_ID)", which depends on other build settings. Android: applicationId in android/app/build.gradle is not a string literal (appId). Check that --cwd is the app directory',
        },
      ]);
    });
  });
});
