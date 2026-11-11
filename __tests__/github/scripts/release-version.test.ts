/**
 * @jest-environment node
 */
// リリースの判定のスクリプト（.github/scripts/release-version.js）。npm に出すか・どの版で出すかを決めるので、
// 境界（beta の番号の数え方、devDependencies だけの変更、公開済み、latest 以下、未公開のパッケージ）を確かめる。
// 入口（コマンドライン）は、workflow と同じく node で直接動かして確かめる（ESM のまま動くこと）。
// npm view と git の出力は文字列で渡す（ネットワークには出ない）
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BETA_VERSION,
  checkNewVersion,
  detectPackageChange,
  isNewerThan,
  isPackageFile,
  main,
  nextBetaVersion,
  PACKAGE_FIELDS,
  parseFileList,
  parseLatest,
  parseTags,
  parseVersions,
  planPush,
  previousReleaseTag,
  STABLE_VERSION,
} from '../../../.github/scripts/release-version.js';

const ROOT = join(__dirname, '..', '..', '..');

const SCRIPT = join(ROOT, '.github', 'scripts', 'release-version.js');

/**
 * リポジトリの package.json のうち、配布物の変更として扱わない項目。package.json に項目を足したら、PACKAGE_FIELDS
 * （変わると beta を出す）かここのどちらかに入れる（入れ忘れると下のテストが落ちる。どちらに入れるかを決めさせるため）
 */
const NOT_PACKAGE_FIELDS = [
  'name',
  'license',
  'packageManager',
  'scripts',
  'repository',
  'keywords',
  'author',
  'bugs',
  'homepage',
  'devDependencies',
  'jest',
];

/** 今の package.json と同じ形の、配布物に関わる項目と関わらない項目 */
const basePackage = {
  name: 'react-native-store-version',
  version: '2.0.0',
  type: 'module',
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
  },
  bin: { 'react-native-store-version': './dist/cli/index.js' },
  files: ['dist', 'src', 'texts', 'CHANGELOG.md'],
  packageManager: 'pnpm@12.17.0',
  scripts: { test: 'jest' },
  peerDependencies: { react: '>=18' },
  peerDependenciesMeta: { 'expo-application': { optional: true } },
  devDependencies: { jest: '^30.0.0' },
};

describe('version patterns', () => {
  it.each([
    ['2.0.0', true],
    ['10.20.30', true],
    ['2.0.0-beta.1', false],
    ['v2.0.0', false],
    ['2.0', false],
    ['2.0.0+build.1', false],
    [' 2.0.0', false],
  ])('STABLE_VERSION %s -> %s', (version, expected) => {
    expect(STABLE_VERSION.test(version)).toBe(expected);
  });

  it.each([
    ['2.0.0-beta.1', true],
    ['2.0.0-beta.12', true],
    ['2.0.0-beta.x', false],
    ['2.0.0-beta', false],
    ['2.0.0-beta.1.1', false],
    ['2.0.0-rc.1', false],
    ['2.0.0', false],
  ])('BETA_VERSION %s -> %s', (version, expected) => {
    expect(BETA_VERSION.test(version)).toBe(expected);
  });
});

describe('isPackageFile', () => {
  it.each([
    ['src/index.ts', true],
    ['src/cli/index.ts', true],
    ['texts/ja.js', true],
    ['action.yml', true],
    ['README.md', false],
    ['CHANGELOG.md', false],
    ['package.json', false],
    ['pnpm-lock.yaml', false],
    ['__tests__/index.test.ts', false],
    ['example/src/sources.ts', false],
    ['.github/workflows/release.yml', false],
    ['srcfoo/index.ts', false],
    ['example/action.yml', false],
  ])('%s -> %s', (path, expected) => {
    expect(isPackageFile(path)).toBe(expected);
  });
});

describe('detectPackageChange', () => {
  it('is unchanged when only documents, tests and the lockfile change', () => {
    expect(
      detectPackageChange({
        files: ['README.md', 'CHANGELOG.md', '__tests__/a.test.ts'],
        basePackage,
        headPackage: basePackage,
      })
    ).toEqual({ changed: false, files: [], fields: [] });
  });

  it('is changed when a file under src/ changes', () => {
    expect(
      detectPackageChange({
        files: ['README.md', 'src/index.ts'],
        basePackage,
        headPackage: basePackage,
      })
    ).toEqual({ changed: true, files: ['src/index.ts'], fields: [] });
  });

  it('is unchanged when only devDependencies, scripts and packageManager change', () => {
    expect(
      detectPackageChange({
        files: ['package.json', 'pnpm-lock.yaml'],
        basePackage,
        headPackage: {
          ...basePackage,
          devDependencies: { jest: '^31.0.0', typescript: '^7.0.2' },
          scripts: { test: 'jest --ci' },
          packageManager: 'pnpm@12.18.0',
        },
      })
    ).toEqual({ changed: false, files: [], fields: [] });
  });

  it.each([
    ['version', '2.0.1'],
    ['type', 'commonjs'],
    ['exports', { '.': './dist/index.js' }],
    ['files', ['dist']],
    ['main', './dist/main.js'],
    ['types', './dist/main.d.ts'],
    ['bin', { rnsv: './dist/cli/index.js' }],
    ['dependencies', { 'left-pad': '1.0.0' }],
    ['peerDependencies', { react: '>=19' }],
    ['peerDependenciesMeta', {}],
  ])('is changed when package.json %s changes', (field, value) => {
    expect(
      detectPackageChange({
        files: ['package.json'],
        basePackage,
        headPackage: { ...basePackage, [field]: value },
      })
    ).toEqual({ changed: true, files: [], fields: [field] });
  });

  it('is changed when a field is removed', () => {
    const { bin: _bin, ...headPackage } = basePackage;
    expect(
      detectPackageChange({ files: [], basePackage, headPackage }).fields
    ).toEqual(['bin']);
  });

  it('classifies every top-level key of the repository package.json', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8')
    ) as Record<string, unknown>;
    const unclassified = Object.keys(rootPackage).filter(
      (key) =>
        !PACKAGE_FIELDS.includes(key) && !NOT_PACKAGE_FIELDS.includes(key)
    );
    expect(unclassified).toEqual([]);
  });

  it('is unchanged when only devDependencies of the repository package.json change', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(
      detectPackageChange({
        files: ['package.json', 'pnpm-lock.yaml'],
        basePackage: rootPackage,
        headPackage: {
          ...rootPackage,
          devDependencies: {
            ...(rootPackage.devDependencies as Record<string, string>),
            jest: '^99.0.0',
          },
        },
      })
    ).toEqual({ changed: false, files: [], fields: [] });
  });

  it('treats a reordered exports as a change (the order of conditions matters)', () => {
    expect(
      detectPackageChange({
        files: [],
        basePackage,
        headPackage: {
          ...basePackage,
          exports: {
            '.': { default: './dist/index.js', types: './dist/index.d.ts' },
          },
        },
      }).changed
    ).toBe(true);
  });
});

describe('parsers', () => {
  it('parseFileList reads NUL- and newline-separated lists', () => {
    expect(parseFileList('src/a.ts\0README.md\0')).toEqual([
      'src/a.ts',
      'README.md',
    ]);
    expect(parseFileList('src/a.ts\nREADME.md\n')).toEqual([
      'src/a.ts',
      'README.md',
    ]);
    expect(parseFileList('')).toEqual([]);
  });

  it('parseVersions reads an array, a single version and an empty output', () => {
    expect(parseVersions('[\n  "1.4.2",\n  "2.0.0-beta.1"\n]\n')).toEqual([
      '1.4.2',
      '2.0.0-beta.1',
    ]);
    // npm view は版が 1 つだけのとき配列ではなく文字列を返す
    expect(parseVersions('"1.0.0"\n')).toEqual(['1.0.0']);
    expect(parseVersions('')).toEqual([]);
    expect(parseVersions('\n')).toEqual([]);
  });

  it('parseVersions rejects unexpected output', () => {
    expect(() => parseVersions('{"error":"x"}')).toThrow(
      'unexpected output of npm view versions'
    );
    expect(() => parseVersions('[1, 2]')).toThrow(
      'unexpected output of npm view versions'
    );
    expect(() => parseVersions('not json')).toThrow();
  });

  it('parseLatest reads a version and an empty output', () => {
    expect(parseLatest('1.4.2\n')).toBe('1.4.2');
    expect(parseLatest('2.0.0-beta.1')).toBe('2.0.0-beta.1');
    expect(parseLatest('')).toBeNull();
  });

  it('parseLatest rejects unexpected output', () => {
    expect(() => parseLatest('"1.4.2"')).toThrow(
      'unexpected dist-tags.latest: \'"1.4.2"\''
    );
    expect(() => parseLatest('latest')).toThrow('unexpected dist-tags.latest');
  });

  it('parseTags reads git ls-remote output and plain names', () => {
    expect(
      parseTags(
        'abc\trefs/tags/v1.4.2\ndef\trefs/tags/v2\nv2.0.0-beta.1\n\nghi\trefs/tags/v1.4.1\n'
      )
    ).toEqual(['v1.4.2', 'v2', 'v2.0.0-beta.1', 'v1.4.1']);
  });
});

describe('isNewerThan', () => {
  it.each([
    ['2.0.0', '1.4.2', true],
    ['1.10.0', '1.9.9', true],
    ['1.4.10', '1.4.9', true],
    ['2.0.0', '2.0.0', false],
    ['1.4.1', '1.4.2', false],
    ['1.9.0', '2.0.0', false],
    // 同じ X.Y.Z のプレリリースより正式版の方が新しい
    ['2.0.0', '2.0.0-beta.3', true],
    ['2.0.0', '2.0.1-beta.1', false],
    ['99999999999999999999.0.0', '99999999999999999998.0.0', true],
  ])('%s > %s -> %s', (version, latest, expected) => {
    expect(isNewerThan(version, latest)).toBe(expected);
  });

  it('throws on a version it cannot compare', () => {
    expect(() => isNewerThan('2.0.0-beta.1', '1.4.2')).toThrow(
      "cannot compare '2.0.0-beta.1' with '1.4.2'"
    );
  });
});

describe('checkNewVersion', () => {
  const versions = ['1.4.1', '1.4.2', '2.0.0-beta.1'];

  it('accepts an unpublished version newer than latest', () => {
    expect(
      checkNewVersion({ version: '2.0.0', versions, latest: '1.4.2' })
    ).toEqual({ ok: true });
  });

  it('accepts any X.Y.Z when the package is not published yet', () => {
    expect(
      checkNewVersion({ version: '0.0.1', versions: [], latest: null })
    ).toEqual({ ok: true });
  });

  it.each([['2.0.0-beta.2'], ['2.0.0-beta.x'], ['v2.0.0'], [undefined]])(
    'rejects a version that is not X.Y.Z (%s)',
    (version) => {
      expect(checkNewVersion({ version, versions, latest: '1.4.2' })).toEqual({
        ok: false,
        reason: 'invalid',
        message: `package.json version (${String(version)}) is not X.Y.Z; set the version to release (prereleases are published by the release workflow)`,
      });
    }
  );

  it('rejects a published version', () => {
    expect(
      checkNewVersion({ version: '1.4.2', versions, latest: '1.4.2' })
    ).toEqual({
      ok: false,
      reason: 'published',
      message:
        '1.4.2 is already published to npm; bump the version in package.json',
    });
  });

  it.each([
    ['1.4.0', '1.4.2'],
    ['2.0.0', '2.0.0'],
  ])('rejects %s, not newer than latest %s', (version, latest) => {
    expect(checkNewVersion({ version, versions: [], latest })).toEqual({
      ok: false,
      reason: 'not-newer',
      message: `${version} is not newer than dist-tags.latest (${latest}); bump the version in package.json`,
    });
  });
});

describe('nextBetaVersion', () => {
  it('starts at 1 when no beta of the version is published', () => {
    expect(nextBetaVersion('2.0.0', [])).toBe('2.0.0-beta.1');
    expect(nextBetaVersion('2.0.0', ['1.4.2', '2.0.1-beta.4'])).toBe(
      '2.0.0-beta.1'
    );
  });

  it('takes the highest published beta + 1', () => {
    expect(
      nextBetaVersion('2.0.0', ['2.0.0-beta.2', '2.0.0-beta.1', '1.4.2'])
    ).toBe('2.0.0-beta.3');
  });

  it('compares the numbers as numbers (10 and above)', () => {
    expect(
      nextBetaVersion('2.0.0', [
        '2.0.0-beta.9',
        '2.0.0-beta.10',
        '2.0.0-beta.2',
      ])
    ).toBe('2.0.0-beta.11');
  });

  it('ignores other forms of prereleases', () => {
    expect(
      nextBetaVersion('2.0.0', [
        '2.0.0-beta.x',
        '2.0.0-beta',
        '2.0.0-beta.',
        '2.0.0-beta.5.1',
        '2.0.0-beta.-7',
        '2.0.0-rc.9',
        '2.0.0-alpha.8',
        '12.0.0-beta.6',
        '2.0.0-beta.3',
      ])
    ).toBe('2.0.0-beta.4');
  });

  it('also counts the beta tags (a number tagged but not on npm is not reused)', () => {
    expect(
      nextBetaVersion(
        '2.0.0',
        ['2.0.0-beta.1'],
        ['v1.4.2', 'v2.0.0-beta.1', 'v2.0.0-beta.2', 'v2', 'v12.0.0-beta.7']
      )
    ).toBe('2.0.0-beta.3');
    expect(nextBetaVersion('2.0.0', [], ['v2.0.0-beta.10'])).toBe(
      '2.0.0-beta.11'
    );
    // 番号の大きい方が npm にあればそちら
    expect(nextBetaVersion('2.0.0', ['2.0.0-beta.5'], ['v2.0.0-beta.2'])).toBe(
      '2.0.0-beta.6'
    );
  });

  it('ignores tags without the v prefix and other forms of beta tags', () => {
    expect(
      nextBetaVersion('2.0.0', [], ['2.0.0-beta.4', 'v2.0.0-beta.x'])
    ).toBe('2.0.0-beta.1');
  });

  it('throws on a version that is not X.Y.Z', () => {
    expect(() => nextBetaVersion('2.0.0-beta.1', [])).toThrow(
      'version (2.0.0-beta.1) is not X.Y.Z'
    );
  });
});

describe('previousReleaseTag', () => {
  it('takes the newest release tag older than the version', () => {
    expect(
      previousReleaseTag('2.0.0', [
        'v1.4.1',
        'v1.4.2',
        'v1.10.0',
        'v1',
        'v2',
        'v2.0.0-beta.1',
        'v2.0.0',
        'v2.1.0',
        '1.9.9',
      ])
    ).toBe('v1.10.0');
  });

  it('compares the numbers, not the order of git ls-remote (sorted by refname)', () => {
    const tags = parseTags(
      [
        'a\trefs/tags/v1',
        'b\trefs/tags/v1.10.0',
        'c\trefs/tags/v1.4.2',
        'd\trefs/tags/v1.9.0',
        'e\trefs/tags/v2.0.0-beta.1',
      ].join('\n')
    );
    expect(tags).toEqual([
      'v1',
      'v1.10.0',
      'v1.4.2',
      'v1.9.0',
      'v2.0.0-beta.1',
    ]);
    expect(previousReleaseTag('2.0.0', tags)).toBe('v1.10.0');
  });

  it('is null when there is no older release tag', () => {
    expect(previousReleaseTag('2.0.0', ['v2', 'v2.0.0-beta.1'])).toBeNull();
    expect(previousReleaseTag('1.0.0', [])).toBeNull();
  });

  it('throws on a version that is not X.Y.Z', () => {
    expect(() => previousReleaseTag('v2.0.0', [])).toThrow(
      'version (v2.0.0) is not X.Y.Z'
    );
  });
});

describe('planPush', () => {
  const tags = ['v1.4.2', 'v2.0.0-beta.1', 'v1'];

  const NOTHING = {
    beta: 'false',
    'beta-version': '',
    draft: 'false',
    'draft-version': '',
    'notes-start-tag': '',
  };

  it('creates a beta and the draft when the package changed', () => {
    expect(
      planPush({
        version: '2.0.0',
        versions: ['1.4.2', '2.0.0-beta.1'],
        latest: '1.4.2',
        tags,
        changed: true,
      })
    ).toEqual({
      outputs: {
        beta: 'true',
        'beta-version': '2.0.0-beta.2',
        draft: 'true',
        'draft-version': '2.0.0',
        'notes-start-tag': 'v1.4.2',
      },
      warning: null,
    });
  });

  it('numbers the beta after a beta tag that is not on npm', () => {
    expect(
      planPush({
        version: '2.0.0',
        versions: ['1.4.2'],
        latest: '1.4.2',
        tags: ['v1.4.2', 'v2.0.0-beta.1'],
        changed: true,
      }).outputs['beta-version']
    ).toBe('2.0.0-beta.2');
  });

  it('creates only the draft when the package did not change', () => {
    expect(
      planPush({
        version: '2.0.0',
        versions: ['1.4.2'],
        latest: '1.4.2',
        tags,
        changed: false,
      })
    ).toEqual({
      outputs: {
        beta: 'false',
        'beta-version': '',
        draft: 'true',
        'draft-version': '2.0.0',
        'notes-start-tag': 'v1.4.2',
      },
      warning: null,
    });
  });

  it('creates the first beta of an unpublished package with no previous release', () => {
    expect(
      planPush({
        version: '1.0.0',
        versions: [],
        latest: null,
        tags: [],
        changed: true,
      }).outputs
    ).toEqual({
      beta: 'true',
      'beta-version': '1.0.0-beta.1',
      draft: 'true',
      'draft-version': '1.0.0',
      'notes-start-tag': '',
    });
  });

  it('creates nothing and warns when the version is already published', () => {
    expect(
      planPush({
        version: '2.0.0',
        versions: ['1.4.2', '2.0.0-beta.3', '2.0.0'],
        latest: '2.0.0',
        tags,
        changed: true,
      })
    ).toEqual({
      outputs: NOTHING,
      warning:
        '2.0.0 is already published to npm; no beta and no draft release are created. Bump the version in package.json',
    });
  });

  it.each([
    ['2.0.5', '2.1.0'],
    ['2.1.0', '2.1.0'],
  ])(
    'creates nothing and warns when %s is not newer than latest %s',
    (version, latest) => {
      expect(
        planPush({
          version,
          versions: ['2.1.0'].filter((published) => published !== version),
          latest,
          tags,
          changed: true,
        })
      ).toEqual({
        outputs: NOTHING,
        warning: `${version} is not newer than dist-tags.latest (${latest}); no beta and no draft release are created. Bump the version in package.json`,
      });
    }
  );

  it('creates a beta for a version newer than a prerelease latest', () => {
    expect(
      planPush({
        version: '2.0.0',
        versions: ['2.0.0-beta.1'],
        latest: '2.0.0-beta.1',
        tags: [],
        changed: true,
      }).outputs.beta
    ).toBe('true');
  });

  it('creates nothing and warns when the release tag already exists', () => {
    expect(
      planPush({
        version: '2.0.0',
        versions: ['1.4.2', '2.0.0-beta.2'],
        latest: '1.4.2',
        tags: ['v1.4.2', 'v2.0.0-beta.2', 'v2.0.0'],
        changed: true,
      })
    ).toEqual({
      outputs: NOTHING,
      warning:
        'the tag v2.0.0 already exists; no beta and no draft release are created. If the release run of v2.0.0 did not publish to npm, re-run it; otherwise bump the version in package.json',
    });
  });

  it.each([['2.0.0-beta.1'], ['2.0'], [undefined]])(
    'throws on a version that is not X.Y.Z (%s)',
    (version) => {
      expect(() =>
        planPush({
          version,
          versions: [],
          latest: null,
          tags: [],
          changed: true,
        })
      ).toThrow(
        `package.json version (${String(version)}) is not X.Y.Z; the release workflow adds the beta number itself`
      );
    }
  );
});

describe('main', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rnsv-release-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** dir にファイルを書き、そのパスを返す */
  const file = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  const pkg = (name: string, value: Record<string, unknown>) =>
    file(name, JSON.stringify(value));

  /** workflow と同じく node で直接動かす */
  const run = (args: string[]) => {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // 止まったときに Jest の上限（20 秒）より先に失敗させる
        timeout: 10_000,
      });
      return { status: 0, stdout };
    } catch (error) {
      const { status, stdout, stderr } = error as {
        status: number;
        stdout: string;
        stderr: string;
      };
      return { status, stdout, stderr };
    }
  };

  /** 同じプロセスで動かす（stdout / stderr を集める） */
  const call = (args: string[]) => {
    let stdout = '';
    let stderr = '';
    const status = main(args, {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    });
    return { status, stdout, stderr };
  };

  it('changed: prints changed=true for a change under src/ (node)', () => {
    const result = run([
      'changed',
      '--files',
      file('files', 'README.md\0src/index.ts\0'),
      '--base-package',
      pkg('base.json', basePackage),
      '--head-package',
      pkg('head.json', basePackage),
    ]);
    expect(result).toEqual({ status: 0, stdout: 'changed=true\n' });
  });

  it('changed: prints changed=false for a devDependencies-only change', () => {
    expect(
      call([
        'changed',
        '--files',
        file('files', 'package.json\0pnpm-lock.yaml\0'),
        '--base-package',
        pkg('base.json', basePackage),
        '--head-package',
        pkg('head.json', {
          ...basePackage,
          devDependencies: { jest: '^31.0.0' },
        }),
      ])
    ).toEqual({
      status: 0,
      stdout: 'changed=false\n',
      stderr: 'no package changes\n',
    });
  });

  it('check: passes an unpublished newer version (node)', () => {
    const result = run([
      'check',
      '--package',
      pkg('package.json', basePackage),
      '--versions',
      file('versions', '["1.4.1","1.4.2","2.0.0-beta.1"]'),
      '--latest',
      file('latest', '1.4.2\n'),
    ]);
    expect(result).toEqual({ status: 0, stdout: '' });
  });

  it('check: passes when the package is not published (empty npm view output)', () => {
    expect(
      call([
        'check',
        '--package',
        pkg('package.json', basePackage),
        '--versions',
        file('versions', ''),
        '--latest',
        file('latest', ''),
      ])
    ).toEqual({
      status: 0,
      stdout: '',
      stderr: '2.0.0 is not published yet and is newer\n',
    });
  });

  it('check: fails on a version not newer than latest', () => {
    expect(
      call([
        'check',
        '--package',
        pkg('package.json', basePackage),
        '--versions',
        file('versions', '["2.1.0"]'),
        '--latest',
        file('latest', '2.1.0\n'),
      ])
    ).toEqual({
      status: 1,
      stdout: '',
      stderr:
        '::error::2.0.0 is not newer than dist-tags.latest (2.1.0); bump the version in package.json\n',
    });
  });

  it('check: fails on a published version (node)', () => {
    const result = run([
      'check',
      '--package',
      pkg('package.json', basePackage),
      '--versions',
      file('versions', '["1.4.2","2.0.0"]'),
      '--latest',
      file('latest', '2.0.0\n'),
    ]);
    expect(result).toEqual({
      status: 1,
      stdout: '',
      stderr:
        '::error::2.0.0 is already published to npm; bump the version in package.json\n',
    });
  });

  it('plan: prints the outputs for a beta and the draft (node)', () => {
    const result = run([
      'plan',
      '--package',
      pkg('package.json', basePackage),
      '--versions',
      file('versions', '["1.4.2","2.0.0-beta.1","2.0.0-beta.2"]'),
      '--latest',
      file('latest', '1.4.2\n'),
      '--tags',
      file('tags', 'a\trefs/tags/v1.4.2\nb\trefs/tags/v2.0.0-beta.2\n'),
      '--changed',
      'true',
    ]);
    expect(result).toEqual({
      status: 0,
      stdout:
        'beta=true\nbeta-version=2.0.0-beta.3\ndraft=true\ndraft-version=2.0.0\nnotes-start-tag=v1.4.2\n',
    });
  });

  it('plan: prints the outputs for only the draft with --changed false', () => {
    expect(
      call([
        'plan',
        '--package',
        pkg('package.json', basePackage),
        '--versions',
        file('versions', '["1.4.1","1.4.2"]'),
        '--latest',
        file('latest', '1.4.2\n'),
        '--tags',
        file('tags', 'a\trefs/tags/v1.4.1\nb\trefs/tags/v1.4.2\n'),
        '--changed',
        'false',
      ])
    ).toEqual({
      status: 0,
      stdout:
        'beta=false\nbeta-version=\ndraft=true\ndraft-version=2.0.0\nnotes-start-tag=v1.4.2\n',
      stderr: '',
    });
  });

  it('plan: warns and creates nothing for a version not newer than latest', () => {
    const { status, stdout, stderr } = call([
      'plan',
      '--package',
      pkg('package.json', basePackage),
      '--versions',
      file('versions', '["2.1.0"]'),
      '--latest',
      file('latest', '2.1.0\n'),
      '--tags',
      file('tags', ''),
      '--changed',
      'true',
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      'beta=false\nbeta-version=\ndraft=false\ndraft-version=\nnotes-start-tag=\n'
    );
    expect(stderr).toMatch(
      /^::warning::2\.0\.0 is not newer than dist-tags\.latest \(2\.1\.0\)/
    );
  });

  it('plan: warns and creates nothing for a published version', () => {
    const { status, stdout, stderr } = call([
      'plan',
      '--package',
      pkg('package.json', basePackage),
      '--versions',
      file('versions', '"2.0.0"'),
      '--latest',
      file('latest', '2.0.0\n'),
      '--tags',
      file('tags', ''),
      '--changed',
      'true',
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      'beta=false\nbeta-version=\ndraft=false\ndraft-version=\nnotes-start-tag=\n'
    );
    expect(stderr).toMatch(/^::warning::2\.0\.0 is already published/);
  });

  it('plan: fails on a version that is not X.Y.Z', () => {
    expect(
      call([
        'plan',
        '--package',
        pkg('package.json', { ...basePackage, version: '2.0.0-beta.1' }),
        '--versions',
        file('versions', ''),
        '--latest',
        file('latest', ''),
        '--tags',
        file('tags', ''),
        '--changed',
        'false',
      ])
    ).toEqual({
      status: 1,
      stdout: '',
      stderr:
        '::error::package.json version (2.0.0-beta.1) is not X.Y.Z; the release workflow adds the beta number itself\n',
    });
  });

  it.each([
    [
      [],
      '::error::unknown command: undefined (expected changed, check or plan)\n',
    ],
    [
      ['publish'],
      '::error::unknown command: publish (expected changed, check or plan)\n',
    ],
    [['check', 'extra'], '::error::unexpected arguments: extra\n'],
    [['check'], '::error::--package is required\n'],
    [
      ['plan', '--changed', 'yes'],
      '::error::--changed must be true or false (got yes)\n',
    ],
  ])('fails on bad arguments %j', (args, stderr) => {
    expect(call(args)).toEqual({ status: 1, stdout: '', stderr });
  });

  it('fails on an unknown option', () => {
    const { status, stderr } = call(['check', '--version', '2.0.0']);
    expect(status).toBe(1);
    expect(stderr).toMatch(/^::error::.*Unknown option '--version'/);
  });

  it('fails when a package.json is not an object', () => {
    expect(
      call([
        'changed',
        '--files',
        file('files', ''),
        '--base-package',
        file('base.json', '[]'),
        '--head-package',
        pkg('head.json', basePackage),
      ])
    ).toEqual({
      status: 1,
      stdout: '',
      stderr: '::error::--base-package is not a package.json object\n',
    });
  });
});
