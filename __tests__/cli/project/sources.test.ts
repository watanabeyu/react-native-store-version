/**
 * @jest-environment node
 */
// ソースの走査（対象の拡張子・除くディレクトリ・シンボリックリンク・上限）
import { chmodSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { displayPath } from '../../../src/cli/project/files.ts';
import {
  EXCLUDED_DIRECTORIES,
  SCAN_LIMITS,
  scanSources,
} from '../../../src/cli/project/sources.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

describe('scanSources', () => {
  let project: Project;
  let outside: Project;

  beforeEach(() => {
    project = createProject();
    outside = createProject();
  });

  afterEach(() => {
    project.remove();
    outside.remove();
  });

  const scan = (limits = SCAN_LIMITS) => {
    const files: string[] = [];
    const result = scanSources(
      project.dir,
      (path, text) => {
        files.push(`${displayPath(project.dir, path)}=${text}`);
      },
      limits
    );
    return { files, result };
  };

  it('has the limits of the spec (5,000 files, 1 MB)', () => {
    expect(SCAN_LIMITS).toEqual({ maxFiles: 5000, maxFileBytes: 1048576 });
  });

  it('reads .ts / .tsx / .js / .jsx (not .d.ts) in name order, breadth first', () => {
    for (const name of [
      'b.tsx',
      'a.ts',
      'src/c.js',
      'src/d.jsx',
      'src/deep/e.ts',
      'types.d.ts',
      'f.mjs',
      'g.json',
      'h.md',
    ]) {
      project.write(name, name);
    }
    expect(scan()).toEqual({
      files: [
        'a.ts=a.ts',
        'b.tsx=b.tsx',
        'src/c.js=src/c.js',
        'src/d.jsx=src/d.jsx',
        'src/deep/e.ts=src/deep/e.ts',
      ],
      result: { scanned: 5, truncated: false, tooLarge: [] },
    });
  });

  it('skips the excluded directories at any depth', () => {
    expect([...EXCLUDED_DIRECTORIES].sort()).toEqual(
      [
        'node_modules',
        'ios',
        'android',
        'dist',
        'build',
        '.expo',
        '.git',
        'Pods',
        'coverage',
        '.next',
      ].sort()
    );
    for (const dir of EXCLUDED_DIRECTORIES) {
      project.write(`${dir}/x.ts`, 'x');
      project.write(`packages/a/${dir}/y.ts`, 'y');
    }
    project.write('packages/a/src/z.ts', 'z');
    expect(scan().files).toEqual(['packages/a/src/z.ts=z']);
  });

  it('does not follow symbolic links to files or directories', () => {
    outside.write('linked/a.ts', 'outside');
    outside.write('file.ts', 'outside');
    symlinkSync(join(outside.dir, 'linked'), join(project.dir, 'linked'));
    symlinkSync(join(outside.dir, 'file.ts'), join(project.dir, 'file.ts'));
    // 循環するリンク
    mkdirSync(join(project.dir, 'src'));
    symlinkSync(project.dir, join(project.dir, 'src', 'loop'));
    project.write('src/app.ts', 'app');
    expect(scan().files).toEqual(['src/app.ts=app']);
  });

  it('stops after the file limit', () => {
    for (const name of ['a.ts', 'b.ts', 'c.ts']) {
      project.write(name, name);
    }
    expect(scan({ maxFiles: 2, maxFileBytes: 100 })).toEqual({
      files: ['a.ts=a.ts', 'b.ts=b.ts'],
      result: { scanned: 2, truncated: true, tooLarge: [] },
    });
    expect(scan({ maxFiles: 3, maxFileBytes: 100 }).result.truncated).toBe(
      false
    );
  });

  it('does not read files over the size limit', () => {
    project.write('big.js', 'x'.repeat(11));
    project.write('small.js', 'x'.repeat(10));
    expect(scan({ maxFiles: 10, maxFileBytes: 10 })).toEqual({
      files: [`small.js=${'x'.repeat(10)}`],
      result: {
        scanned: 1,
        truncated: false,
        tooLarge: [join(project.dir, 'big.js')],
      },
    });
  });

  // root は権限によらず読めるので、権限で読めないことを作れない
  const unlessRoot = process.getuid?.() === 0 ? it.skip : it;

  unlessRoot('skips directories and files that cannot be read', () => {
    project.write('locked/a.ts', 'a');
    project.write('unreadable.ts', 'b');
    project.write('ok.ts', 'c');
    chmodSync(join(project.dir, 'locked'), 0o000);
    chmodSync(join(project.dir, 'unreadable.ts'), 0o000);
    try {
      expect(scan().files).toEqual(['ok.ts=c']);
    } finally {
      chmodSync(join(project.dir, 'locked'), 0o755);
    }
  });

  it('returns nothing for a directory that does not exist', () => {
    expect(
      scanSources(join(tmpdir(), 'rnsv-missing-dir'), () => {
        throw new Error('not called');
      })
    ).toEqual({ scanned: 0, truncated: false, tooLarge: [] });
  });
});
