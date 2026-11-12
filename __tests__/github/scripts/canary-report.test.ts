/**
 * @jest-environment node
 */
// canary の判定と報告の文面（.github/scripts/canary-report.js）。取得は渡した関数で差し替える（ネットワークには出ない）。
// 版が取れればリリースノートと公開日が取れなくても成功のままであること、ストア由来の文字列が無害にされること、
// Google Play の公開日が取れないときだけ警告の行を出すことを確かめる
import {
  check,
  labelOf,
  MAX_REPORT_LENGTH,
  parseApps,
  reportLines,
  runUrl,
  sanitize,
  TIMEOUT_MS,
  toMarkdown,
  warningsFor,
} from '../../../.github/scripts/canary-report.js';

type Fetched = {
  version?: unknown;
  releaseNotes?: unknown;
  releaseDate?: unknown;
};

const ios = {
  platform: 'ios' as const,
  id: 'com.github.stormbreaker.prod',
  country: 'jp',
};
const android = { platform: 'android' as const, id: 'com.github.android' };

const fetchersReturning = (fetched: Fetched) => ({
  lookupIOS: jest.fn(async () => fetched),
  fetchAndroidVersion: jest.fn(async () => fetched),
});

describe('parseApps', () => {
  it('reads ios and android lines and skips blank lines and comments', () => {
    expect(
      parseApps(
        '# apps\nios com.github.stormbreaker.prod jp\n\n  android com.github.android  \n'
      )
    ).toEqual({ apps: [ios, android], errors: [] });
  });

  it('reports a line in the wrong shape and an empty list', () => {
    expect(parseApps('android a b').errors).toEqual([
      'CANARY_APPS line 1 is not "ios <bundleId> <country>" or "android <package>": android a b',
    ]);
    expect(parseApps(undefined).errors).toEqual(['CANARY_APPS has no apps']);
  });
});

describe('check', () => {
  it('calls the fetchers with the app and the timeout', async () => {
    const fetchers = fetchersReturning({ version: '1.0.0' });
    await check(ios, fetchers);
    await check(android, fetchers);
    expect(fetchers.lookupIOS).toHaveBeenCalledWith(
      { bundleId: ios.id },
      'jp',
      { timeoutMs: TIMEOUT_MS }
    );
    expect(fetchers.fetchAndroidVersion).toHaveBeenCalledWith(
      { packageName: android.id },
      { timeoutMs: TIMEOUT_MS }
    );
  });

  it('returns the version, the release date and whether there are release notes', async () => {
    await expect(
      check(
        android,
        fetchersReturning({
          version: '1.283.0',
          releaseNotes: 'notes',
          releaseDate: '2026-11-05T22:49:03Z',
        })
      )
    ).resolves.toEqual({
      ok: true,
      version: '1.283.0',
      releaseDate: '2026-11-05T22:49:03Z',
      hasNotes: true,
    });
  });

  it.each([
    ['missing', {}],
    ['empty or not strings', { releaseNotes: '', releaseDate: 0 }],
  ])(
    'stays ok when the release notes and the release date are %s',
    async (_, extra) => {
      await expect(
        check(android, fetchersReturning({ version: '1.283.0', ...extra }))
      ).resolves.toEqual({
        ok: true,
        version: '1.283.0',
        releaseDate: null,
        hasNotes: false,
      });
    }
  );

  it('fails when the version is not digits and dots', async () => {
    await expect(
      check(ios, fetchersReturning({ version: '1.0-beta' }))
    ).resolves.toEqual({
      ok: false,
      code: 'UNEXPECTED_VERSION_FORMAT',
      message: 'the version is not digits and dots: "1.0-beta"',
    });
  });

  it('turns a rejection into a failure with the code and the messages of the causes', async () => {
    const error = Object.assign(
      new Error('fetch failed', { cause: new Error('ECONNRESET') }),
      { code: 'NETWORK' }
    );
    const fetchers = {
      lookupIOS: jest.fn(async () => {
        throw error;
      }),
      fetchAndroidVersion: jest.fn(),
    };
    await expect(check(ios, fetchers)).resolves.toEqual({
      ok: false,
      code: 'NETWORK',
      message: 'fetch failed <- ECONNRESET',
    });
  });
});

describe('reportLines', () => {
  it('shows the release date and whether there are release notes on the ok lines', () => {
    expect(
      reportLines([
        {
          label: labelOf(ios),
          platform: 'ios',
          ok: true,
          version: '1.284.0',
          releaseDate: '2026-11-12T17:08:48Z',
          hasNotes: true,
        },
        {
          label: labelOf(android),
          platform: 'android',
          ok: true,
          version: '1.283.0',
          releaseDate: null,
          hasNotes: false,
        },
        { label: 'config', ok: false, code: 'CONFIG', message: 'bad line' },
      ])
    ).toEqual([
      'ok      ios com.github.stormbreaker.prod (jp): 1.284.0 (releaseDate: 2026-11-12T17:08:48Z, notes: yes)',
      'ok      android com.github.android: 1.283.0 (releaseDate: none, notes: no)',
      'FAILED  config: CONFIG: bad line',
    ]);
  });

  it('makes a release date from the store harmless (one line, no code fence, no mention)', () => {
    const [line] = reportLines([
      {
        label: 'android x',
        ok: true,
        version: '1.0.0',
        releaseDate: '2026\n```\n@someone',
        hasNotes: false,
      },
    ]);
    expect(line).not.toContain('\n');
    expect(line).not.toContain('```');
    expect(line).not.toContain('@s');
    expect(line).toContain(sanitize('2026\n```\n@someone'));
  });

  it('cuts the report at the length limit', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      label: `android app${index}`,
      ok: true as const,
      version: '1.0.0',
      releaseDate: null,
      hasNotes: false,
    }));
    const lines = reportLines(many);
    expect(lines.join('\n').length).toBeLessThanOrEqual(MAX_REPORT_LENGTH + 20);
    expect(lines.at(-1)).toMatch(/^\.\.\. \(\d+ more\)$/);
  });
});

describe('warningsFor', () => {
  it('warns only for Google Play pages without a release date, with a fixed text', () => {
    expect(
      warningsFor([
        {
          label: labelOf(android),
          platform: 'android',
          ok: true,
          version: '1.283.0',
          releaseDate: null,
          hasNotes: true,
        },
        // the App Store: not a structure change of the Play page
        {
          label: labelOf(ios),
          platform: 'ios',
          ok: true,
          version: '1.284.0',
          releaseDate: null,
          hasNotes: false,
        },
        // no release notes is normal (no "What's new"), so no warning
        {
          label: 'android other',
          platform: 'android',
          ok: true,
          version: '2.0.0',
          releaseDate: '2026-11-05T22:49:03Z',
          hasNotes: false,
        },
        // a failure is already reported as a failure
        {
          label: 'android failed',
          platform: 'android',
          ok: false,
          code: 'PARSE_FAILED',
          message: 'x',
        },
      ])
    ).toEqual([
      '::warning::the release date was not found on the Google Play page (android com.github.android); the page structure may have changed',
    ]);
  });
});

describe('toMarkdown', () => {
  const results = [
    {
      label: labelOf(android),
      platform: 'android' as const,
      ok: true as const,
      version: '1.283.0',
      releaseDate: '2026-11-05T22:49:03Z',
      hasNotes: true,
    },
  ];

  it('puts the result lines in a code block, with the run URL when there is one', () => {
    expect(
      toMarkdown(results, 0, 'https://github.com/o/r/actions/runs/1')
    ).toBe(
      [
        'The canary got the app versions from the stores (all 1 checks passed).',
        '',
        'Run: https://github.com/o/r/actions/runs/1',
        '',
        '```text',
        'ok      android com.github.android: 1.283.0 (releaseDate: 2026-11-05T22:49:03Z, notes: yes)',
        '```',
        '',
      ].join('\n')
    );
  });

  it('counts the failures in the first line', () => {
    expect(toMarkdown(results, 1, null).split('\n')[0]).toBe(
      'The canary could not get the app versions from the stores (1 of 1 checks failed).'
    );
  });
});

describe('runUrl', () => {
  it('builds the run URL only from well-formed values', () => {
    const env = {
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '123',
    };
    expect(runUrl(env)).toBe('https://github.com/o/r/actions/runs/123');
    expect(runUrl({ ...env, GITHUB_RUN_ID: '1 2' })).toBeNull();
    expect(runUrl({})).toBeNull();
  });
});
