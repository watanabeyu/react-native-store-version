/**
 * @jest-environment node
 */
// C2: Expo の設定とネイティブのファイルから ID を決める（読み取りの結果を直接渡す）
import { resolveIds } from '../../../src/cli/checks/ids.ts';
import type { ExpoConfig } from '../../../src/cli/project/expo.ts';
import type { Lookup } from '../../../src/cli/project/files.ts';
import type { ProjectInfo } from '../../../src/cli/project/index.ts';

const PBXPROJ = 'ios/App.xcodeproj/project.pbxproj';
const GRADLE = 'android/app/build.gradle';

const config = (values: Partial<ExpoConfig> = {}): ExpoConfig => ({
  file: 'app.json',
  bundleIdentifier: null,
  package: null,
  version: null,
  ...values,
});

const iosId = (value: string): Lookup => ({
  value,
  label: 'PRODUCT_BUNDLE_IDENTIFIER',
  file: PBXPROJ,
});
const androidId = (value: string): Lookup => ({
  value,
  label: 'applicationId',
  file: GRADLE,
});
const unknown = (reason: string): Lookup => ({ value: null, reason });
const VERSION = unknown('not used');

const projectOf = ({
  expo = null,
  ios = null,
  android = null,
}: {
  expo?: ProjectInfo['expo'];
  ios?: Lookup | null;
  android?: Lookup | null;
}): ProjectInfo => ({
  expo,
  ios: ios && { bundleId: ios, version: VERSION, notes: [] },
  android: android && { packageName: android, version: VERSION, notes: [] },
});

describe('resolveIds (C2)', () => {
  it('uses the Expo config without native directories (CNG)', () => {
    expect(
      resolveIds(
        projectOf({
          expo: {
            config: config({
              file: 'app.config.ts',
              bundleIdentifier: 'com.example.ios',
              package: 'com.example.android',
            }),
            notes: [],
          },
        })
      )
    ).toEqual({
      ios: 'com.example.ios',
      android: 'com.example.android',
      entries: [
        {
          id: 'C2',
          level: 'ok',
          message:
            'iOS bundleId "com.example.ios" (ios.bundleIdentifier in app.config.ts)',
        },
        {
          id: 'C2',
          level: 'ok',
          message:
            'Android package "com.example.android" (android.package in app.config.ts)',
        },
      ],
    });
  });

  it('uses the native value when it matches the Expo config, without a note', () => {
    const result = resolveIds(
      projectOf({
        expo: {
          config: config({ bundleIdentifier: 'a', package: 'b' }),
          notes: [],
        },
        ios: iosId('a'),
        android: androidId('b'),
      })
    );
    expect(result.entries).toEqual([
      {
        id: 'C2',
        level: 'ok',
        message: `iOS bundleId "a" (PRODUCT_BUNDLE_IDENTIFIER in ${PBXPROJ})`,
      },
      {
        id: 'C2',
        level: 'ok',
        message: `Android package "b" (applicationId in ${GRADLE})`,
      },
    ]);
  });

  it('uses the native value and notes it when the Expo config differs', () => {
    const result = resolveIds(
      projectOf({
        expo: { config: config({ package: 'from.config' }), notes: [] },
        android: androidId('from.gradle'),
        ios: iosId('a'),
      })
    );
    expect(result.android).toBe('from.gradle');
    expect(result.entries[2]).toEqual({
      id: 'C2',
      level: 'info',
      message: `the Android package differs between applicationId "from.gradle" (${GRADLE}) and android.package "from.config" (app.json); using the native one, "from.gradle"`,
    });
  });

  it('falls back to the Expo config when the native value cannot be determined, and notes it', () => {
    const result = resolveIds(
      projectOf({
        expo: {
          config: config({ bundleIdentifier: 'from.config' }),
          notes: [],
        },
        ios: unknown('PRODUCT_BUNDLE_IDENTIFIER is "$(X)"'),
        android: androidId('b'),
      })
    );
    expect(result).toEqual({
      ios: 'from.config',
      android: 'b',
      entries: [
        {
          id: 'C2',
          level: 'ok',
          message:
            'iOS bundleId "from.config" (ios.bundleIdentifier in app.json)',
        },
        expect.objectContaining({ level: 'ok' }),
        {
          id: 'C2',
          level: 'info',
          message:
            'could not determine the iOS bundleId from ios/ (PRODUCT_BUNDLE_IDENTIFIER is "$(X)"); using ios.bundleIdentifier "from.config" (app.json)',
        },
      ],
    });
  });

  it('reports info for one platform that cannot be determined (C3 skips it)', () => {
    const result = resolveIds(
      projectOf({
        ios: iosId('a'),
        android: unknown('applicationId is a variable'),
      })
    );
    expect(result).toEqual({
      ios: 'a',
      android: null,
      entries: [
        expect.objectContaining({ level: 'ok' }),
        {
          id: 'C2',
          level: 'info',
          message:
            'could not determine the Android package: applicationId is a variable. C3 skips Android',
        },
      ],
    });
  });

  it.each([
    [
      'no Expo and no native directories',
      projectOf({}),
      'iOS: there is no ios/ directory and expo is not installed. Android: there is no android/ directory and expo is not installed',
    ],
    [
      'an Expo config that could not be read',
      projectOf({ expo: { config: null, notes: ['there is no app.json'] } }),
      'iOS: the Expo config could not be read and there is no ios/ directory. Android: the Expo config could not be read and there is no android/ directory',
    ],
    [
      'an Expo config without the IDs',
      projectOf({ expo: { config: config(), notes: [] } }),
      'iOS: ios.bundleIdentifier is not set in app.json and there is no ios/ directory. Android: android.package is not set in app.json and there is no android/ directory',
    ],
    [
      'native values that cannot be determined',
      projectOf({
        ios: unknown('ios reason'),
        android: unknown('android reason'),
      }),
      'iOS: ios reason. Android: android reason',
    ],
  ])('is an error with %s', (_, project, reasons) => {
    const result = resolveIds(project);
    expect(result.ios).toBeNull();
    expect(result.android).toBeNull();
    expect(result.entries[0]).toEqual({
      id: 'C2',
      level: 'error',
      message: `could not determine either the iOS bundleId or the Android package. ${reasons}. Check that --cwd is the app directory`,
    });
  });

  it('adds the notes of the Expo config and the native projects as info', () => {
    const project = projectOf({ ios: iosId('a'), android: androidId('b') });
    project.expo = { config: null, notes: ['expo note'] };
    if (project.ios && project.android) {
      project.ios.notes.push('ios note');
      project.android.notes.push('android note');
    }
    expect(
      resolveIds(project).entries.filter(({ level }) => level === 'info')
    ).toEqual([
      { id: 'C2', level: 'info', message: 'expo note' },
      { id: 'C2', level: 'info', message: 'ios note' },
      { id: 'C2', level: 'info', message: 'android note' },
    ]);
  });
});
