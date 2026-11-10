/**
 * @jest-environment node
 */
// C8: Android の段階公開の注意（ソースの簡易なテキスト検索）
import { checkRollout } from '../../../src/cli/checks/rollout.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

const NOTE =
  "If you use a staged rollout on Google Play, users outside the rollout cannot get the new version, so a force update from the store version can leave them unable to use the app. When Platform.OS === 'android', set major: 'warning' in the policy, or control force with getMinimumVersion. This is a simple text search and may be a false positive (a policy that already uses major: 'warning' only on Android still has 'force' in it); if so, suppress it with --ignore C8";

const NO_POLICY = "has no policy prop (the default policy has major: 'force')";
const SPREAD = 'has no policy prop (it may come from a spread)';
const FORCE = "has 'force' in its policy";
const NO_MAJOR =
  "does not set major in its policy, so major updates use the default 'force'";

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
    [
      'no policy with a comment in braces (not a spread)',
      '<StoreVersionProvider {/* no props */}>',
      NO_POLICY,
    ],
    ['only a spread', '<StoreVersionProvider {...props} />', SPREAD],
    [
      "'force' in the policy",
      "<StoreVersionProvider policy={{ major: 'force' }}>",
      FORCE,
    ],
    [
      '"force" and no major in the policy',
      '<StoreVersionProvider policy={{ minor: "force" }}>',
      `${FORCE} / ${NO_MAJOR}`,
    ],
    [
      "'force' for iOS only",
      "<StoreVersionProvider policy={Platform.OS === 'ios' ? { major: 'force' } : undefined}>",
      FORCE,
    ],
    [
      'the recommended policy (major: warning only on Android, which still has force)',
      "<StoreVersionProvider policy={{ major: Platform.OS === 'android' ? 'warning' : 'force' }}>",
      FORCE,
    ],
    [
      'a policy without major',
      "<StoreVersionProvider policy={{ minor: 'warning', patch: null }}>",
      NO_MAJOR,
    ],
    ['an empty policy', '<StoreVersionProvider policy={{}}>', NO_MAJOR],
    [
      'major: undefined',
      "<StoreVersionProvider policy={{ 'major': undefined, minor: 'warning' }}>",
      NO_MAJOR,
    ],
    [
      'major: null (with a comment)',
      '<StoreVersionProvider policy={{ major: null /* default */ }}>',
      NO_MAJOR,
    ],
    [
      'policy={undefined}',
      '<StoreVersionProvider policy={undefined}>',
      "has policy={undefined}, so the default policy (major: 'force') is used",
    ],
    [
      'policy={null}',
      '<StoreVersionProvider policy={ null }>',
      "has policy={null}, so the default policy (major: 'force') is used",
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
    [
      'a shorthand major',
      "<StoreVersionProvider policy={{ major, minor: 'warning' }}>",
    ],
    [
      'a policy with a spread (major may come from it)',
      "<StoreVersionProvider policy={{ ...base, minor: 'warning' }}>",
    ],
    ['a policy from a variable', '<StoreVersionProvider policy={POLICY}>'],
    [
      'a function policy',
      '<StoreVersionProvider policy={(diff) => diff.type === "major" ? "warning" : null}>',
    ],
    ['a policy without a value', '<StoreVersionProvider policy>'],
    [
      'only an import',
      "import { StoreVersionProvider } from 'react-native-store-version';",
    ],
    [
      'a tag in a line comment',
      '// <StoreVersionProvider> without a policy is not used here',
    ],
    [
      'a tag in a block comment',
      '/**\n * Wrap the app in <StoreVersionProvider>\n */',
    ],
    [
      'a tag in a string',
      "const example = '<StoreVersionProvider>';\nconst doc = `\n  <StoreVersionProvider>\n`;",
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

  it('does not count getLatestVersion / getMinimumVersion in comments', () => {
    project.write('App.tsx', '<StoreVersionProvider>');
    project.write(
      'src/todo.ts',
      '// TODO: use getMinimumVersion\n/* getLatestVersion */\nexport {};'
    );
    expect(check()).toEqual([warning('App.tsx', NO_POLICY)]);
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

  it('scans ios / android below the root (platform sources)', () => {
    project.write('src/android/Root.tsx', '<StoreVersionProvider>');
    project.write('android/app/src/x.js', '<StoreVersionProvider>');
    expect(check()).toEqual([warning('src/android/Root.tsx', NO_POLICY)]);
  });

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
