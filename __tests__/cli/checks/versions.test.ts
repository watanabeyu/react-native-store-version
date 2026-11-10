/**
 * @jest-environment node
 */
// C4: ローカルの版の一致（読み取りの結果を直接渡す）
import { checkVersions } from '../../../src/cli/checks/versions.ts';
import type { Lookup } from '../../../src/cli/project/files.ts';
import type { ProjectInfo } from '../../../src/cli/project/index.ts';

const ID: Lookup = { value: null, reason: 'not used' };

const projectOf = ({
  expoVersion,
  ios,
  android,
}: {
  /** undefined なら Expo でない */
  expoVersion?: string | null;
  ios?: Lookup;
  android?: Lookup;
}): ProjectInfo => ({
  expo:
    expoVersion === undefined
      ? null
      : {
          config: {
            file: 'app.config.ts',
            bundleIdentifier: null,
            package: null,
            version: expoVersion,
          },
          notes: [],
        },
  ios: ios ? { bundleId: ID, version: ios, notes: [] } : null,
  android: android ? { packageName: ID, version: android, notes: [] } : null,
});

const marketing = (value: string): Lookup => ({
  value,
  label: 'MARKETING_VERSION',
  file: 'ios/App.xcodeproj/project.pbxproj',
});
const versionName = (value: string): Lookup => ({
  value,
  label: 'versionName',
  file: 'android/app/build.gradle.kts',
});

describe('checkVersions (C4)', () => {
  it('is skipped without native directories (CNG), even for Expo', () => {
    for (const project of [
      projectOf({ expoVersion: '1.0.0' }),
      projectOf({}),
    ]) {
      expect(checkVersions(project)).toEqual([
        {
          id: 'C4',
          level: 'skipped',
          message:
            'there is no ios/ or android/ directory (Continuous Native Generation), so there are no native versions to compare',
        },
      ]);
    }
  });

  it('is ok when all versions match', () => {
    expect(
      checkVersions(
        projectOf({
          expoVersion: '1.0.0',
          ios: marketing('1.0.0'),
          android: versionName('1.0.0'),
        })
      )
    ).toEqual([
      {
        id: 'C4',
        level: 'ok',
        message:
          'the versions match: iOS MARKETING_VERSION 1.0.0 (ios/App.xcodeproj/project.pbxproj), Android versionName 1.0.0 (android/app/build.gradle.kts), Expo version 1.0.0 (app.config.ts)',
      },
    ]);
  });

  it('warns about every pair that differs (compared as strings)', () => {
    expect(
      checkVersions(
        projectOf({
          expoVersion: '1.2.0',
          ios: marketing('1.2'),
          android: versionName('1.3.0'),
        })
      )
    ).toEqual([
      {
        id: 'C4',
        level: 'warning',
        message:
          'iOS MARKETING_VERSION 1.2 (ios/App.xcodeproj/project.pbxproj) differs from Android versionName 1.3.0 (android/app/build.gradle.kts)',
      },
      {
        id: 'C4',
        level: 'warning',
        message:
          'iOS MARKETING_VERSION 1.2 (ios/App.xcodeproj/project.pbxproj) differs from Expo version 1.2.0 (app.config.ts)',
      },
      {
        id: 'C4',
        level: 'warning',
        message:
          'Android versionName 1.3.0 (android/app/build.gradle.kts) differs from Expo version 1.2.0 (app.config.ts)',
      },
    ]);
  });

  it('skips the comparisons with a value that cannot be determined (info) and compares the rest', () => {
    expect(
      checkVersions(
        projectOf({
          expoVersion: '2.0.0',
          ios: { value: null, reason: 'MARKETING_VERSION is "$(V)"' },
          android: versionName('2.0.0'),
        })
      )
    ).toEqual([
      {
        id: 'C4',
        level: 'info',
        message:
          'could not determine the iOS version (MARKETING_VERSION is "$(V)"), so it is not compared',
      },
      {
        id: 'C4',
        level: 'ok',
        message:
          'the versions match: Android versionName 2.0.0 (android/app/build.gradle.kts), Expo version 2.0.0 (app.config.ts)',
      },
    ]);
  });

  it('does not compare (and does not report) the Expo version when the config does not set it', () => {
    expect(
      checkVersions(
        projectOf({
          expoVersion: null,
          ios: marketing('1.0.0'),
          android: versionName('1.0.0'),
        })
      )
    ).toEqual([
      {
        id: 'C4',
        level: 'ok',
        message:
          'the versions match: iOS MARKETING_VERSION 1.0.0 (ios/App.xcodeproj/project.pbxproj), Android versionName 1.0.0 (android/app/build.gradle.kts)',
      },
    ]);
    expect(
      checkVersions(projectOf({ expoVersion: null, ios: marketing('1.0.0') }))
    ).toEqual([expect.objectContaining({ id: 'C4', level: 'skipped' })]);
  });

  it('is skipped when only one version is there', () => {
    expect(checkVersions(projectOf({ android: versionName('1.0.0') }))).toEqual(
      [
        {
          id: 'C4',
          level: 'skipped',
          message:
            'only one version was found (Android versionName 1.0.0 (android/app/build.gradle.kts)), so there is nothing to compare',
        },
      ]
    );
  });

  it('does not compare with the Expo config when it could not be read', () => {
    const project = projectOf({
      ios: marketing('1.0.0'),
      android: versionName('1.0.0'),
    });
    project.expo = { config: null, notes: [] };
    expect(checkVersions(project)).toEqual([
      expect.objectContaining({ level: 'ok' }),
    ]);
  });
});
