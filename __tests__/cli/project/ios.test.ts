/**
 * @jest-environment node
 */
// ios/ の project.pbxproj と Info.plist から bundleId と版を読む
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { readIosProject } from '../../../src/cli/project/ios.ts';
import { readFixture } from '../../__helpers__/fetch.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

const PBXPROJ = 'ios/BareApp.xcodeproj/project.pbxproj';
const bare = () => readFixture(`cli/bare-rn/${PBXPROJ}`);

type Target = {
  id: string;
  name: string;
  productType?: string;
  /** Release の buildSettings（`key = value;` を並べたもの）。null なら Release を置かない */
  release: string | null;
};

/** ターゲットを並べた最小の pbxproj（PBXProject の targets は渡した順） */
const pbxproj = (targets: Target[]): string => {
  const objects = targets
    .map(
      ({
        id,
        name,
        productType = 'com.apple.product-type.application',
        release,
      }) => `
		${id}A /* ${name} */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = ${id}B /* Build configuration list */;
			name = ${name};
			productType = "${productType}";
		};
		${id}B = {
			isa = XCConfigurationList;
			buildConfigurations = (
				${id}C /* Debug */,
				${release === null ? '' : `${id}D /* Release */,`}
			);
		};
		${id}C /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = debug.${name};
			};
			name = Debug;
		};
		${release === null ? '' : `${id}D /* Release */ = { isa = XCBuildConfiguration; buildSettings = { ${release} }; name = Release; };`}`
    )
    .join('');
  return `// !$*UTF8*$!
{
	objects = {
		ROOT /* Project object */ = {
			isa = PBXProject;
			targets = (${targets.map(({ id, name }) => `${id}A /* ${name} */`).join(', ')});
		};${objects}
	};
	rootObject = ROOT /* Project object */;
}
`;
};

describe('readIosProject', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  const read = () => readIosProject(project.dir);

  it('is null without ios/ (CNG)', () => {
    expect(read()).toBeNull();
  });

  it('reads the app target (not the test target that comes first in the file) of the bare RN fixture', () => {
    project.copyFixture('bare-rn');
    expect(read()).toEqual({
      bundleId: {
        value: 'com.example.bare',
        label: 'PRODUCT_BUNDLE_IDENTIFIER',
        file: PBXPROJ,
      },
      // Info.plist は $(MARKETING_VERSION) なので MARKETING_VERSION
      version: { value: '2.0.1', label: 'MARKETING_VERSION', file: PBXPROJ },
      notes: [],
    });
  });

  it('reads the Release configuration and the literal CFBundleShortVersionString of the Expo fixture (the widget extension is not an app)', () => {
    project.copyFixture('expo-native');
    expect(read()).toEqual({
      bundleId: {
        value: 'com.example.native',
        label: 'PRODUCT_BUNDLE_IDENTIFIER',
        file: 'ios/ExpoNative.xcodeproj/project.pbxproj',
      },
      version: {
        value: '1.2.0',
        label: 'CFBundleShortVersionString',
        file: 'ios/ExpoNative/Info.plist',
      },
      notes: [],
    });
  });

  it('cannot determine a bundleId with $(…)', () => {
    project.copyFixture('bare-rn');
    project.write(
      PBXPROJ,
      bare().replace(
        /PRODUCT_BUNDLE_IDENTIFIER = "com\.example\.bare";/g,
        'PRODUCT_BUNDLE_IDENTIFIER = "com.example.$(SUFFIX)";'
      )
    );
    expect(read()?.bundleId).toEqual({
      value: null,
      reason: `PRODUCT_BUNDLE_IDENTIFIER of target "BareApp" (Release) in ${PBXPROJ} is "com.example.$(SUFFIX)", which depends on other build settings`,
    });
  });

  describe('CFBundleIdentifier in Info.plist', () => {
    const plist = (id: string) =>
      `<plist><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`;

    beforeEach(() => {
      project.copyFixture('bare-rn');
    });

    it('uses a literal CFBundleIdentifier that matches PRODUCT_BUNDLE_IDENTIFIER, without a note', () => {
      project.write('ios/BareApp/Info.plist', plist('com.example.bare'));
      expect(read()).toMatchObject({
        bundleId: {
          value: 'com.example.bare',
          label: 'CFBundleIdentifier',
          file: 'ios/BareApp/Info.plist',
        },
        notes: [],
      });
    });

    it('uses a literal CFBundleIdentifier that differs from PRODUCT_BUNDLE_IDENTIFIER, and notes it', () => {
      project.write('ios/BareApp/Info.plist', plist('com.example.plist'));
      expect(read()).toMatchObject({
        bundleId: {
          value: 'com.example.plist',
          label: 'CFBundleIdentifier',
          file: 'ios/BareApp/Info.plist',
        },
        notes: [
          `ios/BareApp/Info.plist has CFBundleIdentifier "com.example.plist", but PRODUCT_BUNDLE_IDENTIFIER of target "BareApp" (Release) in ${PBXPROJ} is "com.example.bare"; using the Info.plist one, "com.example.plist"`,
        ],
      });
    });

    it('uses a literal CFBundleIdentifier when PRODUCT_BUNDLE_IDENTIFIER cannot be determined', () => {
      project.write('ios/BareApp/Info.plist', plist('com.example.plist'));
      project.write(
        PBXPROJ,
        bare().replace(
          /PRODUCT_BUNDLE_IDENTIFIER = "com\.example\.bare";/g,
          'PRODUCT_BUNDLE_IDENTIFIER = "$(APP_ID)";'
        )
      );
      expect(read()).toMatchObject({
        bundleId: { value: 'com.example.plist', label: 'CFBundleIdentifier' },
        notes: [],
      });
    });

    it.each([
      ['$(PRODUCT_BUNDLE_IDENTIFIER)'],
      ['com.example.$(SUFFIX)'],
      [''],
    ])('uses PRODUCT_BUNDLE_IDENTIFIER when CFBundleIdentifier is %j', (id) => {
      project.write('ios/BareApp/Info.plist', plist(id));
      expect(read()?.bundleId).toEqual({
        value: 'com.example.bare',
        label: 'PRODUCT_BUNDLE_IDENTIFIER',
        file: PBXPROJ,
      });
    });
  });

  it('uses the first application target in the project order and notes the others', () => {
    project.write(
      'ios/Multi.xcodeproj/project.pbxproj',
      pbxproj([
        {
          id: 'T1',
          name: 'MultiTests',
          productType: 'com.apple.product-type.bundle.unit-test',
          release: 'PRODUCT_BUNDLE_IDENTIFIER = tests;',
        },
        {
          id: 'T2',
          name: 'Multi',
          release:
            'PRODUCT_BUNDLE_IDENTIFIER = com.example.multi; MARKETING_VERSION = 3.0;',
        },
        {
          id: 'T3',
          name: 'MultiWatch',
          release: 'PRODUCT_BUNDLE_IDENTIFIER = watch; SDKROOT = watchos;',
        },
        {
          id: 'T4',
          name: 'MultiStaging',
          release: 'PRODUCT_BUNDLE_IDENTIFIER = com.example.multi.staging;',
        },
        {
          id: 'T5',
          name: 'MultiWidget',
          productType: 'com.apple.product-type.app-extension',
          release: 'PRODUCT_BUNDLE_IDENTIFIER = widget;',
        },
      ])
    );
    expect(read()).toEqual({
      bundleId: {
        value: 'com.example.multi',
        label: 'PRODUCT_BUNDLE_IDENTIFIER',
        file: 'ios/Multi.xcodeproj/project.pbxproj',
      },
      // Multi/Info.plist が無いので MARKETING_VERSION
      version: {
        value: '3.0',
        label: 'MARKETING_VERSION',
        file: 'ios/Multi.xcodeproj/project.pbxproj',
      },
      notes: [
        'ios/Multi.xcodeproj/project.pbxproj has 2 application targets ("Multi", "MultiStaging"); using the first one, "Multi"',
      ],
    });
  });

  it('uses the first .xcodeproj other than Pods.xcodeproj and notes the others', () => {
    project.write('ios/Pods/Pods.xcodeproj/project.pbxproj', 'x');
    mkdirSync(join(project.dir, 'ios', 'Pods.xcodeproj'), { recursive: true });
    project.write(
      'ios/B.xcodeproj/project.pbxproj',
      pbxproj([
        { id: 'B', name: 'B', release: 'PRODUCT_BUNDLE_IDENTIFIER = b;' },
      ])
    );
    project.write(
      'ios/A.xcodeproj/project.pbxproj',
      pbxproj([
        { id: 'A', name: 'A', release: 'PRODUCT_BUNDLE_IDENTIFIER = a;' },
      ])
    );
    const result = read();
    expect(result?.bundleId).toMatchObject({ value: 'a' });
    expect(result?.notes).toEqual([
      'ios/ has 2 .xcodeproj (A.xcodeproj, B.xcodeproj); using the first one, ios/A.xcodeproj',
    ]);
  });

  it('reads Info.plist from INFOPLIST_FILE with $(SRCROOT), and falls back to MARKETING_VERSION for a variable', () => {
    project.write(
      'ios/App.xcodeproj/project.pbxproj',
      pbxproj([
        {
          id: 'A',
          name: 'App',
          release:
            'PRODUCT_BUNDLE_IDENTIFIER = a; INFOPLIST_FILE = "$(SRCROOT)/Config/App-Info.plist"; MARKETING_VERSION = 1.0;',
        },
      ])
    );
    project.write(
      'ios/Config/App-Info.plist',
      '<plist><dict><key>CFBundleShortVersionString</key>\n  <string> 4.5.6 </string></dict></plist>'
    );
    expect(read()?.version).toEqual({
      value: '4.5.6',
      label: 'CFBundleShortVersionString',
      file: 'ios/Config/App-Info.plist',
    });

    project.write(
      'ios/Config/App-Info.plist',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Info.plist の ${…} の参照そのものを入力にする
      '<plist><dict><key>CFBundleShortVersionString</key><string>${APP_VERSION}</string></dict></plist>'
    );
    expect(read()?.version).toMatchObject({
      value: '1.0',
      label: 'MARKETING_VERSION',
    });
  });

  it('does not look for Info.plist when INFOPLIST_FILE depends on another variable', () => {
    project.write(
      'ios/App.xcodeproj/project.pbxproj',
      pbxproj([
        {
          id: 'A',
          name: 'App',
          release:
            'PRODUCT_BUNDLE_IDENTIFIER = a; INFOPLIST_FILE = "$(TARGET_NAME)/Info.plist";',
        },
      ])
    );
    project.write(
      'ios/App/Info.plist',
      '<key>CFBundleShortVersionString</key><string>9.9.9</string>'
    );
    expect(read()?.version).toEqual({
      value: null,
      reason:
        'MARKETING_VERSION is not set in the Release build settings of target "App" in ios/App.xcodeproj/project.pbxproj',
    });
  });

  it.each([
    [
      'no .xcodeproj',
      () => mkdirSync(join(project.dir, 'ios'), { recursive: true }),
      'there is no .xcodeproj in ios/ (other than Pods.xcodeproj)',
    ],
    [
      'no project.pbxproj',
      () =>
        mkdirSync(join(project.dir, 'ios', 'App.xcodeproj'), {
          recursive: true,
        }),
      'could not read ios/App.xcodeproj/project.pbxproj',
    ],
    [
      'a broken project.pbxproj',
      () => project.write('ios/App.xcodeproj/project.pbxproj', '{ objects = {'),
      'could not parse ios/App.xcodeproj/project.pbxproj: unexpected end at offset 13',
    ],
    [
      'a project.pbxproj whose root is not a dictionary',
      () => project.write('ios/App.xcodeproj/project.pbxproj', '(a)'),
      'could not parse ios/App.xcodeproj/project.pbxproj: the root is not a dictionary',
    ],
    [
      'no objects',
      () => project.write('ios/App.xcodeproj/project.pbxproj', '{ a = b; }'),
      'could not parse ios/App.xcodeproj/project.pbxproj: no "objects" in the project',
    ],
    [
      'no application target',
      () =>
        project.write(
          'ios/App.xcodeproj/project.pbxproj',
          pbxproj([
            {
              id: 'T',
              name: 'Tests',
              productType: 'com.apple.product-type.bundle.unit-test',
              release: 'PRODUCT_BUNDLE_IDENTIFIER = t;',
            },
          ])
        ),
      'there is no application target in ios/App.xcodeproj/project.pbxproj',
    ],
    [
      'no Release configuration',
      () =>
        project.write(
          'ios/App.xcodeproj/project.pbxproj',
          pbxproj([{ id: 'A', name: 'App', release: null }])
        ),
      'target "App" in ios/App.xcodeproj/project.pbxproj has no Release build configuration',
    ],
  ])('cannot determine anything with %s', (_, arrange, reason) => {
    arrange();
    const result = read();
    expect(result?.bundleId).toEqual({ value: null, reason });
    expect(result?.version).toEqual({ value: null, reason });
  });

  it('finds the targets from the objects when rootObject cannot be followed', () => {
    project.write(
      'ios/App.xcodeproj/project.pbxproj',
      pbxproj([
        { id: 'A', name: 'App', release: 'PRODUCT_BUNDLE_IDENTIFIER = a;' },
      ]).replace('rootObject = ROOT', 'rootObject = MISSING')
    );
    expect(read()?.bundleId).toMatchObject({ value: 'a' });
  });

  it('cannot determine a bundleId that is not set in Release (even if Debug has one)', () => {
    project.write(
      'ios/App.xcodeproj/project.pbxproj',
      pbxproj([{ id: 'A', name: 'App', release: 'MARKETING_VERSION = 1.0;' }])
    );
    expect(read()?.bundleId).toEqual({
      value: null,
      reason:
        'PRODUCT_BUNDLE_IDENTIFIER is not set in the Release build settings of target "App" in ios/App.xcodeproj/project.pbxproj',
    });
  });
});
