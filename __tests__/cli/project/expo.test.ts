/**
 * @jest-environment node
 */
// Expo の設定を expo/config の getConfig で読む（node_modules/expo/config.js は一時ディレクトリに組み立てた代わり）
import { join } from 'node:path';

import {
  readExpoProject,
  withStdoutToStderr,
} from '../../../src/cli/project/expo.ts';
import {
  createProject,
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
      'exports.getConfig = () => ({ exp: { version: "1.0.0" } });'
    );
    expect(read()?.config).toMatchObject({
      file: 'the Expo config',
      version: '1.0.0',
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

    it('does not use an expo/config of another expo (NODE_PATH or a nested node_modules. D57 ①)', () => {
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
    const write = process.stdout.write;
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
    expect(write).toBeDefined();
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
