/**
 * @jest-environment node
 */
// C1: react-native-store-version がインストールされていて v2 以上か
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkInstalled } from '../../../src/cli/checks/installed.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

const NAME = 'react-native-store-version';

describe('checkInstalled (C1)', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  it.each([
    ['1.4.2', 'info'],
    ['1.99.0', 'info'],
    ['1.0.0', 'info'],
    ['2.0.0-0', 'ok'],
    ['2.0.0-alpha.0', 'ok'],
    ['2.0.0-beta.1', 'ok'],
    ['2.0.0-rc.3', 'ok'],
    ['2.0.0', 'ok'],
    ['2.3.1', 'ok'],
    ['10.0.0', 'ok'],
  ])('version %s → %s', (version, level) => {
    project.install(NAME, { name: NAME, version });
    expect(checkInstalled(project.dir)).toEqual([
      {
        id: 'C1',
        level,
        message:
          level === 'info'
            ? `${NAME} ${version} is v1. StoreVersionProvider and this check are for v2 or later`
            : `${NAME} ${version} is installed`,
      },
    ]);
  });

  it('is an error when it is not installed', () => {
    expect(checkInstalled(project.dir)).toEqual([
      {
        id: 'C1',
        level: 'error',
        message: `${NAME} is not installed (no node_modules/${NAME}/package.json in ${project.dir} or its parents)`,
      },
    ]);
  });

  it('does not look at a package installed under an alias name', () => {
    // `"react-native-store-version-v1": "npm:react-native-store-version@1.4.1"` の形（example と同じ）
    project.install(`${NAME}-v1`, { name: NAME, version: '2.0.0' });
    expect(checkInstalled(project.dir)).toMatchObject([
      { id: 'C1', level: 'error' },
    ]);
  });

  it('finds the package in a parent node_modules (hoisted in a monorepo)', () => {
    project.install(NAME, { name: NAME, version: '2.0.0' });
    const app = join(project.dir, 'apps', 'mobile');
    mkdirSync(app, { recursive: true });
    expect(checkInstalled(app)).toEqual([
      { id: 'C1', level: 'ok', message: `${NAME} 2.0.0 is installed` },
    ]);
  });

  it('reads package.json directly regardless of exports', () => {
    project.install(NAME, {
      name: NAME,
      version: '2.0.0',
      type: 'module',
      exports: { '.': './dist/index.js' },
    });
    expect(checkInstalled(project.dir)).toMatchObject([
      { id: 'C1', level: 'ok' },
    ]);
  });

  it('is an error when the package at that name is another package', () => {
    project.install(NAME, { name: 'some-fork', version: '2.0.0' });
    const [entry] = checkInstalled(project.dir);
    expect(entry).toEqual({
      id: 'C1',
      level: 'error',
      message: `${join(project.dir, 'node_modules', NAME, 'package.json')} is not ${NAME} (name: "some-fork")`,
    });
  });

  it.each([
    ['not comparable', { version: 'next' }, '"next"'],
    ['missing', {}, 'undefined'],
    ['not a string', { version: 2 }, '2'],
  ])('is an error when the version is %s', (_, fields, shown) => {
    project.install(NAME, { name: NAME, ...fields });
    expect(checkInstalled(project.dir)).toEqual([
      {
        id: 'C1',
        level: 'error',
        message: `could not read the version of ${NAME} in ${join(project.dir, 'node_modules', NAME, 'package.json')} (version: ${shown})`,
      },
    ]);
  });

  it('is an error when the package.json cannot be parsed', () => {
    project.install(NAME, {});
    const path = join(project.dir, 'node_modules', NAME, 'package.json');
    writeFileSync(path, '{ broken');
    const [entry] = checkInstalled(project.dir);
    expect(entry).toMatchObject({ id: 'C1', level: 'error' });
    expect(entry.message.startsWith(`could not read ${path}: `)).toBe(true);
  });

  it('is an error when node_modules/<name>/package.json is a directory', () => {
    mkdirSync(join(project.dir, 'node_modules', NAME, 'package.json'), {
      recursive: true,
    });
    expect(checkInstalled(project.dir)).toMatchObject([
      {
        id: 'C1',
        level: 'error',
        message: expect.stringContaining('is not installed'),
      },
    ]);
  });
});
