/**
 * @jest-environment node
 */
// CLI の本体（src/cli/main.ts）: 引数の解析、出力の選び方（テキスト / --json / GitHub Actions）、Job Summary、終了コード
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as check from '../../src/cli/check.ts';
import { main, type RunContext, run, USAGE } from '../../src/cli/main.ts';
import type { CheckEntry } from '../../src/cli/result.ts';
import { createResponse, readFixture } from '../__helpers__/fetch.ts';
import {
  createProject,
  installExpo,
  type Project,
} from '../__helpers__/project.ts';

const NAME = 'react-native-store-version';

type Captured = RunContext & { out: string; err: string };

const contextFor = (
  cwd: string,
  env: Record<string, string | undefined> = {}
): Captured => {
  const captured: Captured = {
    cwd,
    env,
    out: '',
    err: '',
    stdout: (text) => {
      captured.out += text;
    },
    stderr: (text) => {
      captured.err += text;
    },
  };
  return captured;
};

describe('run', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  const stubChecks = (entries: CheckEntry[]) =>
    jest.spyOn(check, 'runChecks').mockResolvedValue(entries);

  describe('commands and help', () => {
    it.each([['--help'], ['-h'], ['check', '--help'], ['check', '-h']])(
      '%s prints the usage to stdout and exits with 0',
      async (...argv) => {
        const spy = stubChecks([]);
        const ctx = contextFor(project.dir);
        await expect(run(argv, ctx)).resolves.toBe(0);
        expect(ctx.out).toBe(USAGE);
        expect(ctx.err).toBe('');
        expect(spy).not.toHaveBeenCalled();
      }
    );

    it.each([
      [[], 'no command given'],
      [['lint'], 'unknown command: lint'],
      [['check', 'extra'], 'unexpected argument: extra'],
      [['check', '--nope'], "Unknown option '--nope'"],
      [['check', '--cwd'], "Option '--cwd <value>' argument missing"],
      [['check', '--json=yes'], "Option '--json' does not take an argument"],
    ])(
      '%j prints the error and the usage to stderr and exits with 1',
      async (argv, message) => {
        const spy = stubChecks([]);
        const ctx = contextFor(project.dir);
        await expect(run(argv, ctx)).resolves.toBe(1);
        expect(ctx.out).toBe('');
        expect(ctx.err).toMatch(/^error: /);
        expect(ctx.err).toContain(message);
        expect(ctx.err.endsWith(`\n\n${USAGE}`)).toBe(true);
        expect(spy).not.toHaveBeenCalled();
      }
    );

    it('also prints an ::error:: annotation of the argument error to stderr on GitHub Actions, and nothing to stdout', async () => {
      const spy = stubChecks([]);
      for (const argv of [['lint'], ['check', '--country', 'u:s,']]) {
        const ctx = contextFor(project.dir, { GITHUB_ACTIONS: 'true' });
        await expect(run(argv, ctx)).resolves.toBe(1);
        expect(ctx.out).toBe('');
        const message = ctx.err.slice('error: '.length).split('\n\n')[0];
        expect(ctx.err).toContain(`\n\n${USAGE}`);
        expect(
          ctx.err.endsWith(
            `::error title=react-native-store-version check::${message}\n`
          )
        ).toBe(true);
      }
      // 改行を含む値でも、stderr に `::` で始まる行は注釈の 1 行だけ
      const ctx = contextFor(project.dir, { GITHUB_ACTIONS: 'true' });
      await run(['check', 'x\n::warning::y'], ctx);
      expect(ctx.out).toBe('');
      expect(ctx.err.split('\n').filter((l) => l.startsWith('::'))).toEqual([
        '::error title=react-native-store-version check::unexpected argument: x%0A::warning::y',
      ]);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('options', () => {
    it('defaults: the current directory, country us, nothing ignored, text output', async () => {
      const spy = stubChecks([]);
      const ctx = contextFor(project.dir);
      await expect(run(['check'], ctx)).resolves.toBe(0);
      expect(spy).toHaveBeenCalledWith({
        cwd: project.dir,
        country: 'us',
        ignore: new Set(),
      });
      expect(ctx.out).toMatch(/^react-native-store-version check: /);
    });

    it('--cwd is resolved from the current directory', async () => {
      const app = join(project.dir, 'apps', 'mobile');
      mkdirSync(app, { recursive: true });
      const spy = stubChecks([]);
      await run(['check', '--cwd', 'apps/mobile'], contextFor(project.dir));
      await run(['check', `--cwd=${app}`], contextFor('/'));
      expect(spy.mock.calls.map(([args]) => args.cwd)).toEqual([app, app]);
    });

    it.each([
      ['missing', 'nope'],
      ['a file', 'package.json'],
    ])('--cwd to %s is an error', async (_, dir) => {
      const spy = stubChecks([]);
      const ctx = contextFor(project.dir);
      await expect(run(['check', '--cwd', dir], ctx)).resolves.toBe(1);
      expect(ctx.err).toContain(
        `error: --cwd: ${join(project.dir, dir)} is not a directory`
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('--country is a 2-letter code, lowercased', async () => {
      const spy = stubChecks([]);
      await run(['check', '--country', 'JP'], contextFor(project.dir));
      expect(spy.mock.calls[0][0].country).toBe('jp');

      for (const bad of ['usa', 'u', '', 'j1']) {
        const ctx = contextFor(project.dir);
        await expect(run(['check', `--country=${bad}`], ctx)).resolves.toBe(1);
        expect(ctx.err).toContain(
          `error: --country: ${JSON.stringify(bad)} is not a 2-letter country code`
        );
      }
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('--ignore takes comma-separated IDs (case-insensitive, repeatable, empty parts skipped)', async () => {
      const spy = stubChecks([]);
      await run(
        ['check', '--ignore', 'C1, c7,', '--ignore', 'C8'],
        contextFor(project.dir)
      );
      expect(spy.mock.calls[0][0].ignore).toEqual(new Set(['C1', 'C7', 'C8']));
    });

    it.each(['C', 'C1,foo', '1'])('--ignore %j is an error', async (value) => {
      const spy = stubChecks([]);
      const ctx = contextFor(project.dir);
      await expect(run(['check', '--ignore', value], ctx)).resolves.toBe(1);
      expect(ctx.err).toMatch(/^error: --ignore: ".*" is not a check ID/);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('exit codes', () => {
    const entry = (level: CheckEntry['level']): CheckEntry => ({
      id: 'C3',
      level,
      message: level,
    });

    it.each([
      [['ok', 'skipped'], [], 0],
      [['info'], [], 0],
      [['info'], ['--strict'], 0],
      [['warning'], [], 0],
      [['warning'], ['--strict'], 1],
      [['error'], [], 1],
      [['error', 'info'], ['--strict'], 1],
    ] as [CheckEntry['level'][], string[], number][])(
      '%j with %j → %d (also in the JSON and on GitHub Actions)',
      async (levels, flags, code) => {
        stubChecks(levels.map(entry));
        const text = contextFor(project.dir);
        await expect(run(['check', ...flags], text)).resolves.toBe(code);
        const json = contextFor(project.dir);
        await expect(run(['check', '--json', ...flags], json)).resolves.toBe(
          code
        );
        expect(JSON.parse(json.out).exitCode).toBe(code);
        const github = contextFor(project.dir, { GITHUB_ACTIONS: 'true' });
        await expect(run(['check', ...flags], github)).resolves.toBe(code);
      }
    );

    it('exits with 1 when the checks fail unexpectedly', async () => {
      jest.spyOn(check, 'runChecks').mockRejectedValue(new Error('boom'));
      const ctx = contextFor(project.dir);
      await expect(run(['check'], ctx)).resolves.toBe(1);
      expect(ctx.out).toBe('');
      expect(ctx.err).toBe('error: boom\n');
    });

    it('prints the unexpected failure on one line with an ::error:: annotation to stderr on GitHub Actions, and nothing to stdout (with or without --json)', async () => {
      jest
        .spyOn(check, 'runChecks')
        .mockRejectedValue(new Error('boom: 100%\nnext'));
      for (const flags of [[], ['--json']]) {
        const ctx = contextFor(project.dir, { GITHUB_ACTIONS: 'true' });
        await expect(run(['check', ...flags], ctx)).resolves.toBe(1);
        expect(ctx.out).toBe('');
        expect(ctx.err).toBe(
          'error: boom: 100% next\n::error title=react-native-store-version check::boom: 100%25%0Anext\n'
        );
      }
    });
  });

  describe('output', () => {
    const entries: CheckEntry[] = [
      { id: 'C1', level: 'error', message: 'line 1\nline 2' },
      { id: 'C3', level: 'skipped', message: 'no ID' },
      { id: 'C7', level: 'info', message: 'no peers' },
    ];

    it('prints text by default (also when GITHUB_ACTIONS is not "true")', async () => {
      stubChecks(entries);
      for (const env of [{}, { GITHUB_ACTIONS: 'false' }]) {
        const ctx = contextFor(project.dir, env);
        await run(['check'], ctx);
        expect(ctx.out).toBe(
          [
            `react-native-store-version check: ${project.dir}`,
            // 改行は空白にして 1 行に収める
            '  error    C1  line 1 line 2',
            '  skipped  C3  no ID',
            '  info     C7  no peers',
            '1 error, 0 warnings, 1 info',
            '',
          ].join('\n')
        );
        expect(ctx.err).toBe('');
      }
    });

    it('prints only JSON with --json, even on GitHub Actions (no annotations), and still appends the job summary', async () => {
      stubChecks(entries);
      const summary = join(project.dir, 'summary.md');
      const ctx = contextFor(project.dir, {
        GITHUB_ACTIONS: 'true',
        GITHUB_STEP_SUMMARY: summary,
      });
      await expect(run(['check', '--json'], ctx)).resolves.toBe(1);
      expect(JSON.parse(ctx.out)).toEqual({
        cwd: project.dir,
        results: entries,
        counts: { error: 1, warning: 0, info: 1 },
        exitCode: 1,
      });
      const written = readFileSync(summary, 'utf8');
      expect(
        written.startsWith('\n### react-native-store-version check\n')
      ).toBe(true);
      expect(written).toContain('| C1 | error | line 1<br>line 2 |');
      expect(ctx.err).toBe('');
    });

    it('does not write the job summary with --json outside GitHub Actions', async () => {
      stubChecks(entries);
      const summary = join(project.dir, 'summary.md');
      const ctx = contextFor(project.dir, { GITHUB_STEP_SUMMARY: summary });
      await run(['check', '--json'], ctx);
      expect(JSON.parse(ctx.out).exitCode).toBe(1);
      expect(() => readFileSync(summary)).toThrow();
    });

    it('prints annotations and appends the job summary on GitHub Actions', async () => {
      stubChecks(entries);
      const summary = join(project.dir, 'summary.md');
      writeFileSync(summary, '# earlier step\n');
      const ctx = contextFor(project.dir, {
        GITHUB_ACTIONS: 'true',
        GITHUB_STEP_SUMMARY: summary,
      });
      await expect(run(['check'], ctx)).resolves.toBe(1);
      expect(ctx.out).toBe(
        [
          `react-native-store-version check: ${project.dir}`,
          '::error title=react-native-store-version check C1::line 1%0Aline 2',
          '  skipped  C3  no ID',
          '::notice title=react-native-store-version check C7::no peers',
          '1 error, 0 warnings, 1 info',
          '',
        ].join('\n')
      );
      const written = readFileSync(summary, 'utf8');
      expect(written.startsWith('# earlier step\n\n### ')).toBe(true);
      expect(written).toContain('| C1 | error | line 1<br>line 2 |');
      expect(ctx.err).toBe('');
    });

    it('prints annotations without a job summary when GITHUB_STEP_SUMMARY is not set', async () => {
      stubChecks(entries);
      const ctx = contextFor(project.dir, { GITHUB_ACTIONS: 'true' });
      await run(['check'], ctx);
      expect(ctx.out).toContain('::error title=');
      expect(ctx.err).toBe('');
    });

    it('keeps the exit code when the job summary cannot be written', async () => {
      stubChecks([{ id: 'C7', level: 'info', message: 'no peers' }]);
      const ctx = contextFor(project.dir, {
        GITHUB_ACTIONS: 'true',
        // ディレクトリには追記できない
        GITHUB_STEP_SUMMARY: project.dir,
      });
      await expect(run(['check'], ctx)).resolves.toBe(0);
      expect(ctx.out).toContain('::notice title=');
      expect(ctx.err).toMatch(/^warning: could not write the job summary: /);
    });
  });

  describe('with the real checks', () => {
    it('reports a v1 install as info and exits with 0 on an Expo app without native directories (like the example app on CI)', async () => {
      project.install(NAME, { name: NAME, version: '1.4.2' });
      project.install('expo-application', {
        name: 'expo-application',
        version: '1.0.0',
      });
      project.copyFixture('expo-cng');
      installExpo(project);
      // example の ID はストアに無い（未公開）
      jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
        String(input).startsWith('https://itunes.apple.com/')
          ? createResponse({
              body: readFixture('store/itunes-lookup-empty.json'),
            })
          : createResponse({ status: 404 })
      );
      const ctx = contextFor(project.dir);
      await expect(run(['check', '--ignore', 'C8'], ctx)).resolves.toBe(0);
      expect(ctx.out).toBe(
        [
          `react-native-store-version check: ${project.dir}`,
          `  info     C1  ${NAME} 1.4.2 is v1. StoreVersionProvider and this check are for v2 or later`,
          '  ok       C2  iOS bundleId "com.example.cng" (ios.bundleIdentifier in app.config.js)',
          '  ok       C2  Android package "com.example.cng" (android.package in app.config.js)',
          '  warning  C3  bundleId "com.example.cng" is not found on the App Store (us): not published yet, a wrong ID, or not available in that country',
          '  warning  C3  package "com.example.cng" is not found on Google Play: not published yet, a wrong ID, or not available in the country of this network',
          '  skipped  C4  there is no ios/ or android/ directory (Continuous Native Generation), so there are no native versions to compare',
          '  ok       C7  expo-application found for detecting the app version and ID',
          '0 errors, 2 warnings, 1 info',
          '',
        ].join('\n')
      );
    });

    it('exits with 1 when it is not installed, and 0 when C1 is ignored (and C1 is not in the result)', async () => {
      project.copyFixture('bare-rn');
      const failing = contextFor(project.dir);
      await expect(run(['check', '--json'], failing)).resolves.toBe(1);
      expect(JSON.parse(failing.out).results[0]).toMatchObject({
        id: 'C1',
        level: 'error',
      });

      const ignored = contextFor(project.dir);
      await expect(
        run(['check', '--json', '--ignore', 'C1'], ignored)
      ).resolves.toBe(0);
      expect(
        JSON.parse(ignored.out).results.map((r: CheckEntry) => r.id)
      ).toEqual(['C2', 'C2', 'C3', 'C3', 'C4', 'C7', 'C8']);
    });

    it('is an error (exit code 1) when neither ID can be determined', async () => {
      project.install(NAME, { name: NAME, version: '2.0.0' });
      const ctx = contextFor(project.dir);
      await expect(
        run(['check', '--json', '--ignore', 'C3,C4,C7,C8'], ctx)
      ).resolves.toBe(1);
      expect(JSON.parse(ctx.out).results).toEqual([
        expect.objectContaining({ id: 'C1', level: 'ok' }),
        expect.objectContaining({ id: 'C2', level: 'error' }),
      ]);
    });
  });
});

describe('main', () => {
  afterEach(() => {
    // Jest の process は本物の process の写しだが、exitCode のアクセサは本物につながっている（Jest 自体の終了コードになる）
    process.exitCode = undefined;
  });

  it('runs with process.argv / process.cwd() / process.env and sets process.exitCode', async () => {
    const stdout = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    jest.replaceProperty(process, 'argv', ['node', 'cli', '--help']);
    await main();
    expect(stdout).toHaveBeenCalledWith(USAGE);
    expect(process.exitCode).toBe(0);

    jest.replaceProperty(process, 'argv', ['node', 'cli', 'nope']);
    await main();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('unknown command: nope')
    );
    expect(process.exitCode).toBe(1);
  });
});
