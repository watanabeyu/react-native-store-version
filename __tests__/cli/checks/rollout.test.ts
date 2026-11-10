/**
 * @jest-environment node
 */
// C8: Android の段階公開の注意（ソースの簡易なテキスト検索）
import { checkRollout } from '../../../src/cli/checks/rollout.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

const NOTE =
  "If you use a staged rollout on Google Play, users outside the rollout cannot get the new version, so a force update from the store version can leave them unable to use the app. When Platform.OS === 'android', set major: 'warning' in the policy, or control force with getMinimumVersion. This is a simple text search and may be a false positive; suppress it with --ignore C8";

const NO_POLICY = "has no policy prop (the default policy has major: 'force')";
const FORCE = "has 'force' in its policy";

const warning = (file: string, reasons: string) => ({
  id: 'C8',
  level: 'warning',
  message: `${file}: <StoreVersionProvider> ${reasons}, and getLatestVersion / getMinimumVersion is not used in the sources. ${NOTE}`,
});

describe('checkRollout (C8)', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  const check = (limits?: Parameters<typeof checkRollout>[2]) =>
    checkRollout(project.dir, 'com.example.app', limits);

  it('is skipped without an Android package', () => {
    project.write('App.tsx', '<StoreVersionProvider>');
    expect(checkRollout(project.dir, null)).toEqual([
      {
        id: 'C8',
        level: 'skipped',
        message:
          'no Android package was determined, so the staged rollout note does not apply',
      },
    ]);
  });

  it.each([
    ['no policy', '<StoreVersionProvider onError={report}>', NO_POLICY],
    ['only a spread', '<StoreVersionProvider {...props} />', NO_POLICY],
    [
      "'force' in the policy",
      "<StoreVersionProvider policy={{ major: 'force' }}>",
      FORCE,
    ],
    [
      '"force" in the policy',
      '<StoreVersionProvider policy={{ minor: "force" }}>',
      FORCE,
    ],
    [
      "'force' for iOS only",
      "<StoreVersionProvider policy={Platform.OS === 'ios' ? { major: 'force' } : undefined}>",
      FORCE,
    ],
  ])('warns about %s', (_, tag, reasons) => {
    project.write('src/App.tsx', `const a = 1;\n${tag}\n`);
    expect(check()).toEqual([warning('src/App.tsx', reasons)]);
  });

  it.each([
    [
      'a policy without force',
      "<StoreVersionProvider policy={{ major: 'warning' }}>",
    ],
    ['a policy from a variable', '<StoreVersionProvider policy={POLICY}>'],
    [
      'a function policy',
      '<StoreVersionProvider policy={(diff) => diff.type === "major" ? "warning" : null}>',
    ],
    [
      'only an import',
      "import { StoreVersionProvider } from 'react-native-store-version';",
    ],
  ])('does not warn about %s', (_, source) => {
    project.write('App.tsx', source);
    expect(check()).toEqual([
      {
        id: 'C8',
        level: 'ok',
        message:
          'no <StoreVersionProvider> that forces updates from the store version was found (1 file scanned)',
      },
    ]);
  });

  it.each(['getLatestVersion', 'getMinimumVersion'])(
    'does not warn when %s is in any scanned file',
    (name) => {
      project.write('App.tsx', '<StoreVersionProvider>');
      project.write('src/version.js', `export const ${name} = () => '1.0.0';`);
      expect(check()).toEqual([
        {
          id: 'C8',
          level: 'ok',
          message:
            'getLatestVersion / getMinimumVersion is used (src/version.js), so force updates do not depend only on the store version',
        },
      ]);
    }
  );

  it('does not count getLatestVersion in a .d.ts or an excluded directory', () => {
    project.write('App.tsx', '<StoreVersionProvider>');
    project.write(
      'types/store.d.ts',
      'declare const getLatestVersion: () => string;'
    );
    project.write('node_modules/x/index.js', 'getMinimumVersion');
    expect(check()).toEqual([warning('App.tsx', NO_POLICY)]);
  });

  it('warns once per file, listing the reasons of its tags once each', () => {
    project.write(
      'a.tsx',
      "<StoreVersionProvider>\n<StoreVersionProvider policy={{ major: 'force' }}>\n<StoreVersionProvider>"
    );
    project.write(
      'b.jsx',
      '<StoreVersionProvider policy={{ major: "force" }} />'
    );
    expect(check()).toEqual([
      warning('a.tsx', `${NO_POLICY} / ${FORCE}`),
      warning('b.jsx', FORCE),
    ]);
  });

  it('stops scanning over the file limit and does not judge (info)', () => {
    project.write('a.ts', '<StoreVersionProvider>');
    project.write('b.ts', '');
    expect(check({ maxFiles: 1, maxFileBytes: 1000 })).toEqual([
      {
        id: 'C8',
        level: 'info',
        message:
          'stopped scanning the sources at 1 file (.ts / .tsx / .js / .jsx outside node_modules, ios, android, and build output), so the staged rollout note was not checked. Check --cwd, or suppress this with --ignore C8',
      },
    ]);
  });

  it('reports the files over the size limit (info) and judges the rest', () => {
    project.write('App.tsx', '<StoreVersionProvider>');
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      project.write(`vendor/${name}.js`, 'x'.repeat(100));
    }
    expect(check({ maxFiles: 100, maxFileBytes: 50 })).toEqual([
      {
        id: 'C8',
        level: 'info',
        message:
          'did not scan 7 source files larger than 50 bytes: vendor/a.js, vendor/b.js, vendor/c.js, vendor/d.js, vendor/e.js and 2 more',
      },
      warning('App.tsx', NO_POLICY),
    ]);
    project.write('vendor/a.js', 'x'.repeat(100));
    expect(check({ maxFiles: 100, maxFileBytes: 99 })[0].message).toMatch(
      /^did not scan 7 source files larger than 99 bytes: /
    );
  });

  it('says "file" for one file over the size limit', () => {
    project.write('big.js', 'x'.repeat(100));
    expect(check({ maxFiles: 100, maxFileBytes: 50 })[0].message).toBe(
      'did not scan 1 source file larger than 50 bytes: big.js'
    );
  });
});
