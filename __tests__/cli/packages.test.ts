/**
 * @jest-environment node
 */
// `<cwd>` から親へ node_modules/<name>/package.json を探す部分（NODE_PATH は見ない。src/cli/packages.ts の冒頭）
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findPackageJson, isInstalled } from '../../src/cli/packages.ts';
import { createProject, type Project } from '../__helpers__/project.ts';

const NAME = 'some-package';

const writePackage = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: NAME, version: '1.0.0' })
  );
};

describe('findPackageJson / isInstalled', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  it('is null when the package is nowhere', () => {
    expect(findPackageJson(project.dir, NAME)).toBeNull();
    expect(isInstalled(project.dir, NAME)).toBe(false);
  });

  it('finds node_modules/<name> linked to another place (pnpm / workspace links), keeping the link path', () => {
    const store = join(project.dir, 'store', NAME);
    writePackage(store);
    mkdirSync(join(project.dir, 'node_modules'), { recursive: true });
    symlinkSync(store, join(project.dir, 'node_modules', NAME), 'dir');
    expect(findPackageJson(project.dir, NAME)).toBe(
      join(project.dir, 'node_modules', NAME, 'package.json')
    );
    expect(isInstalled(project.dir, NAME)).toBe(true);
  });

  it('looks at the parent node_modules when the link is broken', () => {
    const app = join(project.dir, 'apps', 'mobile');
    mkdirSync(join(app, 'node_modules'), { recursive: true });
    symlinkSync(
      join(project.dir, 'missing'),
      join(app, 'node_modules', NAME),
      'dir'
    );
    expect(findPackageJson(app, NAME)).toBeNull();
    writePackage(join(project.dir, 'node_modules', NAME));
    expect(findPackageJson(app, NAME)).toBe(
      join(project.dir, 'node_modules', NAME, 'package.json')
    );
  });

  it('does not look for node_modules/node_modules/<name> (like Node)', () => {
    const cwd = join(project.dir, 'node_modules', 'foo');
    mkdirSync(cwd, { recursive: true });
    writePackage(join(project.dir, 'node_modules', 'node_modules', NAME));
    expect(findPackageJson(cwd, NAME)).toBeNull();
    // 1 つ上のディレクトリ（node_modules でない）の node_modules は見る
    writePackage(join(project.dir, 'node_modules', NAME));
    expect(findPackageJson(cwd, NAME)).toBe(
      join(project.dir, 'node_modules', NAME, 'package.json')
    );
    rmSync(join(project.dir, 'node_modules', NAME), { recursive: true });
    // cwd 自身の node_modules は見る
    writePackage(join(cwd, 'node_modules', NAME));
    expect(findPackageJson(cwd, NAME)).toBe(
      join(cwd, 'node_modules', NAME, 'package.json')
    );
  });
});
