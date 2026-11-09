/**
 * @jest-environment node
 */
// C7: version / ID の自動取得に使う optional peer（expo-application / react-native-device-info）があるか
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { checkPeers } from '../../../src/cli/checks/peers.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

describe('checkPeers (C7)', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  // `pnpm test` の Jest は pnpm の shim から起動され、NODE_PATH に node_modules/.pnpm/node_modules（example の expo-application も
  // 巻き上げられている）を持つ。require.resolve で探すとここで expo-application が見つかってしまう（src/cli/packages.ts の冒頭）ので、
  // ここが info になることは NODE_PATH を見ないことの確認にもなる
  it('is info when neither peer can be found', () => {
    expect(checkPeers(project.dir)).toEqual([
      {
        id: 'C7',
        level: 'info',
        message:
          'neither expo-application nor react-native-device-info is installed. Pass version / bundleId / packageName to StoreVersionProvider, or install one of them',
      },
    ]);
  });

  it.each([
    [['expo-application'], 'expo-application'],
    [['react-native-device-info'], 'react-native-device-info'],
    [
      ['react-native-device-info', 'expo-application'],
      'expo-application and react-native-device-info',
    ],
  ])('is ok when %j is installed', (names, shown) => {
    for (const name of names) {
      project.install(name, { name, version: '1.0.0' });
    }
    expect(checkPeers(project.dir)).toEqual([
      {
        id: 'C7',
        level: 'ok',
        message: `${shown} found for detecting the app version and ID`,
      },
    ]);
  });

  it('counts a package whose exports do not expose package.json as installed', () => {
    project.install('expo-application', {
      name: 'expo-application',
      version: '1.0.0',
      exports: { '.': './index.js' },
    });
    expect(checkPeers(project.dir)).toMatchObject([{ id: 'C7', level: 'ok' }]);
  });

  it('finds a peer in a parent node_modules (hoisted in a monorepo)', () => {
    project.install('react-native-device-info', {
      name: 'react-native-device-info',
      version: '1.0.0',
    });
    const app = join(project.dir, 'apps', 'mobile');
    mkdirSync(app, { recursive: true });
    expect(checkPeers(app)).toMatchObject([{ id: 'C7', level: 'ok' }]);
  });

  it('does not find a peer that is only in another directory', () => {
    const other = createProject({
      'expo-application': { name: 'expo-application', version: '1.0.0' },
    });
    try {
      expect(checkPeers(project.dir)).toMatchObject([
        { id: 'C7', level: 'info' },
      ]);
      expect(checkPeers(other.dir)).toMatchObject([{ id: 'C7', level: 'ok' }]);
    } finally {
      other.remove();
    }
  });
});
