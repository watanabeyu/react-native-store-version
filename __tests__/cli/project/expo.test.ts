/**
 * @jest-environment node
 */
// Expo の設定を expo/config の getConfig で読む（node_modules/expo/config.js は一時ディレクトリに組み立てた代わり）
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import {
  readExpoProject,
  withStdoutToStderr,
} from '../../../src/cli/project/expo.ts';
import {
  createProject,
  FAKE_EXPO_CONFIG,
  installExpo,
  type Project,
} from '../../__helpers__/project.ts';

describe('readExpoProject', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  const read = () => readExpoProject(project.dir);
  const appJson = (json: unknown) =>
    project.write('app.json', JSON.stringify(json));

  it('is null when expo is not installed (even with an Expo app.json)', () => {
    project.copyFixture('expo-native');
    expect(read()).toBeNull();
  });

  it('evaluates app.config.js with getConfig (with skipSDKVersionRequirement)', () => {
    project.copyFixture('expo-cng');
    installExpo(project);
    expect(read()).toEqual({
      config: {
        file: 'app.config.js',
        bundleIdentifier: 'com.example.cng',
        package: 'com.example.cng',
        version: '1.2.0',
      },
      notes: [],
    });
  });

  it('names app.json when there is no dynamic config', () => {
    project.copyFixture('expo-native');
    installExpo(project);
    expect(read()?.config).toEqual({
      file: 'app.json',
      bundleIdentifier: 'com.example.native',
      package: 'com.example.native',
      version: '1.2.0',
    });
  });

  it('finds expo in a parent node_modules (hoisted in a monorepo) and evaluates the app directory', () => {
    installExpo(project);
    const app = join(project.dir, 'apps', 'mobile');
    project.write(
      'apps/mobile/app.json',
      JSON.stringify({
        expo: { ios: { bundleIdentifier: 'com.example.mono' } },
      })
    );
    expect(readExpoProject(app)?.config).toEqual({
      file: 'app.json',
      bundleIdentifier: 'com.example.mono',
      package: null,
      version: null,
    });
  });

  it('treats non-string and empty values as missing', () => {
    installExpo(project);
    appJson({
      expo: { version: 1, ios: { bundleIdentifier: '' }, android: 'x' },
    });
    expect(read()?.config).toEqual({
      file: 'app.json',
      bundleIdentifier: null,
      package: null,
      version: null,
    });
  });

  it('names "the Expo config" when getConfig does not return the paths', () => {
    installExpo(
      project,
      'exports.getConfig = () => ({ exp: { version: "1.0.0" }, rootConfig: { version: "1.0.0" } });'
    );
    expect(read()?.config).toMatchObject({
      file: 'the Expo config',
      version: '1.0.0',
    });
  });

  describe('the version is used only when the config has it (getConfig fills it from package.json)', () => {
    it('is null when app.json has no version, even though getConfig fills it from package.json', () => {
      project.write(
        'package.json',
        JSON.stringify({ name: 'bare', version: '0.0.1' })
      );
      installExpo(project);
      appJson({ name: 'BareApp', displayName: 'BareApp' });
      expect(read()?.config).toEqual({
        file: 'app.json',
        bundleIdentifier: null,
        package: null,
        version: null,
      });
    });

    it('is null without app.json or a dynamic config', () => {
      installExpo(project);
      expect(read()?.config).toEqual({
        file: 'the Expo config',
        bundleIdentifier: null,
        package: null,
        version: null,
      });
    });

    it.each([
      ['under the expo key', { expo: { version: '3.0.0' } }],
      ['at the top level', { version: '3.0.0' }],
    ])('uses the version written in app.json (%s)', (_, json) => {
      installExpo(project);
      appJson(json);
      expect(read()?.config?.version).toBe('3.0.0');
    });

    it('uses the version from a dynamic config, unwrapping { expo: {...} }', () => {
      installExpo(project);
      project.write(
        'app.config.js',
        'module.exports = () => ({ expo: { version: "4.0.0", android: { package: "com.example.wrapped" } } });'
      );
      expect(read()?.config).toEqual({
        file: 'app.config.js',
        bundleIdentifier: null,
        package: 'com.example.wrapped',
        version: '4.0.0',
      });
    });

    it.each([
      ['only returns config', 'module.exports = ({ config }) => config;'],
      [
        'spreads config',
        "module.exports = ({ config }) => ({ ...config, android: { package: 'com.example.a' } });",
      ],
    ])(
      'is null for a dynamic config that %s (the version is the one Expo fills from package.json)',
      (_, source) => {
        project.write(
          'package.json',
          JSON.stringify({ name: 'app', version: '0.0.1' })
        );
        installExpo(project);
        project.write('app.config.js', source);
        expect(read()?.config?.version).toBeNull();
      }
    );

    it("is null for a dynamic config without a version when package.json has none (Expo fills '1.0.0')", () => {
      installExpo(project);
      project.write(
        'app.config.js',
        'module.exports = ({ config }) => config;'
      );
      expect(read()?.config?.version).toBeNull();
    });

    it('uses the version of a dynamic config that spreads a static config with a version', () => {
      project.write(
        'package.json',
        JSON.stringify({ name: 'app', version: '0.0.1' })
      );
      installExpo(project);
      appJson({ expo: { version: '0.0.1' } });
      project.write(
        'app.config.js',
        'module.exports = ({ config }) => config;'
      );
      expect(read()?.config?.version).toBe('0.0.1');
    });

    it('treats a version written in a dynamic config that equals package.json as not written (a limitation)', () => {
      project.write(
        'package.json',
        JSON.stringify({ name: 'app', version: '2.0.0' })
      );
      installExpo(project);
      project.write(
        'app.config.js',
        "module.exports = ({ config }) => ({ ...config, version: '2.0.0' });"
      );
      expect(read()?.config?.version).toBeNull();
    });

    it('uses a version written in a dynamic config that differs from package.json', () => {
      project.write(
        'package.json',
        JSON.stringify({ name: 'app', version: '2.0.0' })
      );
      installExpo(project);
      project.write(
        'app.config.js',
        "module.exports = ({ config }) => ({ ...config, version: '2.1.0' });"
      );
      expect(read()?.config?.version).toBe('2.1.0');
    });
  });

  it('falls back to app.json when getConfig throws because there is no package.json', () => {
    installExpo(project);
    rmSync(join(project.dir, 'package.json'));
    appJson({ expo: { version: '1.0.0' } });
    expect(read()).toEqual({
      config: expect.objectContaining({ file: 'app.json', version: '1.0.0' }),
      notes: [
        `could not evaluate the Expo config with expo/config (The expected package.json path: package.json does not exist); read app.json directly instead`,
      ],
    });
  });

  it('evaluates expo in the pnpm isolated layout (node_modules/expo is a symlink into .pnpm)', () => {
    const store = 'node_modules/.pnpm/expo@58.0.0/node_modules/expo';
    project.write(
      `${store}/package.json`,
      JSON.stringify({
        name: 'expo',
        version: '58.0.0',
        exports: {
          './package.json': './package.json',
          './config': { default: './config/index.js' },
        },
      })
    );
    project.write(`${store}/config/index.js`, FAKE_EXPO_CONFIG);
    symlinkSync(
      join(project.dir, store),
      join(project.dir, 'node_modules', 'expo'),
      'dir'
    );
    appJson({
      expo: { version: '5.0.0', ios: { bundleIdentifier: 'com.example.pnpm' } },
    });
    expect(read()).toEqual({
      config: {
        file: 'app.json',
        bundleIdentifier: 'com.example.pnpm',
        package: null,
        version: '5.0.0',
      },
      notes: [],
    });
  });

  describe('when getConfig cannot be used, it reads app.json directly', () => {
    it.each([
      [
        'getConfig throws (the lines before the code frame, on one line, relative to cwd)',
        'exports.getConfig = (root) => { throw new Error("Error reading Expo config at " + root + "/app.config.js:\\n\\n" + root + "/app.config.js: Unexpected token (2:8)\\n\\n  1 | module.exports = ({config}) => ({\\n> 2 |   name: ,\\n    |         ^"); };',
        'Error reading Expo config at app.config.js: app.config.js: Unexpected token (2:8)',
      ],
      [
        'getConfig throws a long message',
        'exports.getConfig = () => { throw new Error("x".repeat(400)); };',
        `${'x'.repeat(300)}…`,
      ],
      [
        'expo/config throws when loaded',
        'throw new TypeError("broken");',
        'broken',
      ],
      [
        'there is no getConfig',
        'exports.other = 1;',
        'expo/config does not export getConfig',
      ],
      [
        'getConfig returns something else',
        'exports.getConfig = () => Promise.resolve({ exp: {} });',
        'getConfig did not return { exp }',
      ],
      [
        'getConfig throws a non-Error',
        'exports.getConfig = () => { throw "nope"; };',
        'nope',
      ],
      [
        // 別の realm の Error（Jest のモジュールの解決・vm で評価した設定）は instanceof Error が偽になる。`Error: ` を付けない
        'getConfig throws an Error of another realm',
        'exports.getConfig = () => { throw require("node:vm").runInNewContext("new Error(\'from another realm\')"); };',
        'from another realm',
      ],
    ])('%s', (_, source, reason) => {
      installExpo(project, source);
      appJson({ expo: { version: '1.0.0', ios: { bundleIdentifier: 'a' } } });
      expect(read()).toEqual({
        config: {
          file: 'app.json',
          bundleIdentifier: 'a',
          package: null,
          version: '1.0.0',
        },
        notes: [
          `could not evaluate the Expo config with expo/config (${reason}); read app.json directly instead`,
        ],
      });
    });

    it('reads the top level when app.json has no expo key', () => {
      installExpo(project, 'exports.getConfig = null;');
      appJson({ version: '2.0.0', android: { package: 'b' } });
      expect(read()?.config).toEqual({
        file: 'app.json',
        bundleIdentifier: null,
        package: 'b',
        version: '2.0.0',
      });
    });

    it('cannot read the config when the expo that was found has no expo/config', () => {
      project.install('expo', { name: 'expo', version: '58.0.0' });
      expect(read()).toEqual({
        config: null,
        notes: [
          // Jest を pnpm の bin の shim から動かすと NODE_PATH にこのリポジトリの .pnpm/node_modules が入り、そこの expo の
          // expo/config が解決されるので「見つけた expo のものではない」になる。NODE_PATH が無ければ解決そのものが失敗する
          expect.stringMatching(
            /^could not evaluate the Expo config with expo\/config \((node_modules\/expo does not provide expo\/config|Cannot find module 'expo\/config'.*)\); read app\.json directly instead$/
          ),
          'there is no app.json',
        ],
      });
    });

    it('does not use an expo/config of another expo (NODE_PATH or a nested node_modules)', () => {
      project.install('expo', { name: 'expo', version: '58.0.0' });
      project.install('expo/node_modules/expo', {
        name: 'expo',
        version: '57.0.0',
      });
      project.write(
        'node_modules/expo/node_modules/expo/config.js',
        'exports.getConfig = () => ({ exp: { version: "9.9.9" } });'
      );
      appJson({ expo: { version: '1.0.0' } });
      expect(read()).toEqual({
        config: expect.objectContaining({ file: 'app.json', version: '1.0.0' }),
        notes: [
          'could not evaluate the Expo config with expo/config (node_modules/expo does not provide expo/config); read app.json directly instead',
        ],
      });
    });

    it.each([
      ['broken JSON', '{ "expo": ', /^could not parse app\.json: /],
      ['not an object', '[1]', /^app\.json is not a JSON object$/],
    ])('cannot read the config with %s in app.json', (_, text, note) => {
      installExpo(project, 'exports.getConfig = null;');
      project.write('app.json', text);
      const result = read();
      expect(result?.config).toBeNull();
      expect(result?.notes[1]).toMatch(note);
    });
  });
});

describe('withStdoutToStderr', () => {
  it('sends stdout writes and console.log / info / debug to stderr during the call, and restores them', () => {
    const { log, info, debug } = console;
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const stdout = jest.spyOn(process.stdout, 'write');
    // spy を張った後の関数を、元に戻ったかの比較に使う
    const spied = process.stdout.write;

    expect(
      withStdoutToStderr(() => {
        process.stdout.write('raw\n');
        console.log('log %d', 1);
        console.info('info');
        console.debug({ a: 1 });
        return 'result';
      })
    ).toBe('result');
    expect(stderr.mock.calls.map(([text]) => String(text))).toEqual([
      'raw\n',
      'log 1\n',
      'info\n',
      '{ a: 1 }\n',
    ]);
    expect(stdout).not.toHaveBeenCalled();
    expect(process.stdout.write).toBe(spied);
    expect([console.log, console.info, console.debug]).toEqual([
      log,
      info,
      debug,
    ]);
  });

  it('restores them when the call throws', () => {
    const { log } = console;
    const write = process.stdout.write;
    expect(() =>
      withStdoutToStderr(() => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(console.log).toBe(log);
    expect(process.stdout.write).toBe(write);
  });
});
