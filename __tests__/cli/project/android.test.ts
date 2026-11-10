/**
 * @jest-environment node
 */
// android/app/build.gradle(.kts) から package と版を読む
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { readAndroidProject } from '../../../src/cli/project/android.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

describe('readAndroidProject', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  const read = () => readAndroidProject(project.dir);
  const gradle = (source: string, name = 'build.gradle') =>
    project.write(`android/app/${name}`, source);

  it('is null without android/ (CNG)', () => {
    expect(read()).toBeNull();
  });

  it.each([
    ['bare-rn', 'com.example.bare', '2.0.1'],
    ['expo-native', 'com.example.native', '1.2.0'],
  ])('reads defaultConfig of the %s fixture', (fixture, id, version) => {
    project.copyFixture(fixture);
    expect(read()).toEqual({
      packageName: {
        value: id,
        label: 'applicationId',
        file: 'android/app/build.gradle',
      },
      version: {
        value: version,
        label: 'versionName',
        file: 'android/app/build.gradle',
      },
      notes: [],
    });
  });

  it('reads build.gradle.kts', () => {
    gradle(
      `plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.kts"
    defaultConfig {
        applicationId = "com.example.kts"
        versionName = "3.1.0"
        versionCode = 31
    }
}
`,
      'build.gradle.kts'
    );
    expect(read()).toEqual({
      packageName: {
        value: 'com.example.kts',
        label: 'applicationId',
        file: 'android/app/build.gradle.kts',
      },
      version: {
        value: '3.1.0',
        label: 'versionName',
        file: 'android/app/build.gradle.kts',
      },
      notes: [],
    });
  });

  it('prefers build.gradle when both exist', () => {
    gradle('android { defaultConfig { applicationId "groovy" } }');
    gradle(
      'android { defaultConfig { applicationId = "kotlin" } }',
      'build.gradle.kts'
    );
    expect(read()?.packageName).toMatchObject({ value: 'groovy' });
  });

  it('falls back to the namespace when defaultConfig has no applicationId', () => {
    gradle(`android {
    namespace 'com.example.ns'
    defaultConfig {
        versionName "1.0.0"
    }
}`);
    expect(read()?.packageName).toEqual({
      value: 'com.example.ns',
      label: 'namespace',
      file: 'android/app/build.gradle',
    });
  });

  it('does not fall back to the namespace when applicationId is a variable', () => {
    gradle(`android {
    namespace "com.example.ns"
    defaultConfig {
        applicationId appId
        versionName versionFromFile()
    }
}`);
    expect(read()).toEqual({
      packageName: {
        value: null,
        reason:
          'applicationId in android/app/build.gradle is not a string literal (appId)',
      },
      version: {
        value: null,
        reason:
          'versionName in android/app/build.gradle is not a string literal (versionFromFile())',
      },
      notes: [],
    });
  });

  it('uses the first defaultConfig', () => {
    gradle(`android {
    defaultConfig {
        applicationId "first"
    }
}
android {
    defaultConfig {
        applicationId "second"
    }
}`);
    expect(read()?.packageName).toMatchObject({ value: 'first' });
  });

  it('ignores productFlavors / applicationIdSuffix and notes it', () => {
    gradle(`android {
    defaultConfig {
        applicationId "com.example.flavored"
        versionName "1.0.0"
    }
    buildTypes {
        debug {
            applicationIdSuffix ".debug"
        }
    }
    flavorDimensions "env"
    productFlavors {
        staging {
            dimension "env"
            applicationId "com.example.flavored.staging"
            versionName "1.0.0-staging"
        }
    }
}`);
    expect(read()).toEqual({
      packageName: {
        value: 'com.example.flavored',
        label: 'applicationId',
        file: 'android/app/build.gradle',
      },
      version: {
        value: '1.0.0',
        label: 'versionName',
        file: 'android/app/build.gradle',
      },
      notes: [
        'android/app/build.gradle has productFlavors and applicationIdSuffix; they are ignored, and the package without a flavor or suffix is used',
      ],
    });
  });

  it('notes only the one that is there', () => {
    gradle(
      'android { defaultConfig { applicationId "a" } productFlavors { x { } } }'
    );
    expect(read()?.notes).toEqual([
      'android/app/build.gradle has productFlavors; it is ignored, and the package without a flavor or suffix is used',
    ]);
  });

  it.each([
    [
      'no build.gradle',
      () => mkdirSync(join(project.dir, 'android'), { recursive: true }),
      'there is no android/app/build.gradle or android/app/build.gradle.kts',
    ],
    [
      'a build.gradle that cannot be read',
      () =>
        mkdirSync(join(project.dir, 'android', 'app', 'build.gradle'), {
          recursive: true,
        }),
      'there is no android/app/build.gradle or android/app/build.gradle.kts',
    ],
  ])('cannot determine anything with %s', (_, arrange, reason) => {
    arrange();
    expect(read()).toEqual({
      packageName: { value: null, reason },
      version: { value: null, reason },
      notes: [],
    });
  });

  it('cannot determine anything without defaultConfig or namespace', () => {
    gradle('android {\n  compileSdk 35\n}\n');
    expect(read()).toEqual({
      packageName: {
        value: null,
        reason:
          'there is no applicationId in defaultConfig or namespace in android { } of android/app/build.gradle',
      },
      version: {
        value: null,
        reason:
          'there is no versionName in defaultConfig of android/app/build.gradle',
      },
      notes: [],
    });
  });
});
