// checkVersion（src/checkVersion.ts）のテスト。Provider と同じ detect / resolve に載せた結果の形（skipped / ready）と、
// 既定値（country / timeoutMs）、reject の順（resolve の reject → errors の INVALID_VERSION → MINIMUM_VERSION_FAILED）、
// signal の取り消しを確かめる。取得と判定そのものの細部は resolve.test.ts / detect.test.ts / fetchers/ で見る
import { checkVersion } from '../src/checkVersion.ts';
import { DEFAULT_TIMEOUT_MS } from '../src/detect.ts';
import { StoreVersionError } from '../src/errors.ts';
import type { VersionGetter } from '../src/fetchers/custom.ts';
import type { ResolveResult } from '../src/resolve.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  mockFetchResponse,
  requestOf,
} from './__helpers__/fetch.ts';
import { setOptionalModules } from './__helpers__/modules.ts';
import { setPlatform } from './__helpers__/platform.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

const bundleId = 'com.github.stormbreaker.prod';
const packageName = 'com.github.android';
const iosNotes = "What's new\n\n…";
const iosDate = '2026-11-05T14:25:25Z';
const androidNotes =
  'Meet the redesigned Copilot in GitHub Mobile!\n\n- Chat and code in one Copilot tab.\n- Run secure, isolated cloud sessions and resume later - no computer needed.';
const androidDate = '2026-11-05T22:49:03Z';

// request.ts は取得中の Promise をモジュールの中で共有するので、保留の fetch を使うテストは ID を変えて混ざらないようにする
let seq = 0;
const uniqueId = () => {
  seq += 1;
  return `com.example.check${seq}`;
};

const catchError = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('did not reject');
};

const getter = (value: string | null | undefined) =>
  jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(
    async () => value
  );

const failing = () =>
  jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(async () => {
    throw new Error('remote config failed');
  });

const mockLocale = (locale: unknown) =>
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () =>
      ({
        resolvedOptions: () => ({ locale }),
      }) as Intl.DateTimeFormat
  );

beforeEach(() => {
  setPlatform('ios');
  // 既定では expo-application / react-native-device-info は入っていない（自動取得できない）
  setOptionalModules();
});

describe('checkVersion: skipped', () => {
  it('skips on web without fetching (even without the version and the ID)', async () => {
    setPlatform('web');
    const { calls } = mockFetchPending();
    await expect(checkVersion()).resolves.toEqual({
      status: 'skipped',
      reason: 'web',
    });
    expect(calls).toHaveLength(0);
  });

  it.each(['windows', 'macos'] as const)(
    'skips %s as unsupported-platform',
    async (os) => {
      setPlatform(os);
      await expect(
        checkVersion({ version: '1.0.0', bundleId })
      ).resolves.toEqual({ status: 'skipped', reason: 'unsupported-platform' });
    }
  );

  it.each([
    ['ios', 'host.exp.Exponent'],
    ['android', 'host.exp.exponent'],
  ] as const)(
    'skips Expo Go (%s) without fetching, even with explicit values',
    async (os, applicationId) => {
      setPlatform(os);
      setOptionalModules({
        'expo-application': {
          nativeApplicationVersion: '2.0.0',
          applicationId,
        },
      });
      const { calls } = mockFetchPending();
      await expect(
        checkVersion({ version: '1.0.0', bundleId, packageName })
      ).resolves.toEqual({ status: 'skipped', reason: 'expo-go' });
      expect(calls).toHaveLength(0);
    }
  );
});

describe('checkVersion: explicit values and auto detection', () => {
  it('uses the explicit version and bundleId without the optional modules (iOS)', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.282.0', bundleId, country: 'jp' })
    ).resolves.toMatchObject({ status: 'ready', local: '1.282.0' });
    expect(requestOf(spy).url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?bundleId=com\.github\.stormbreaker\.prod&country=jp&\d+$/
    );
  });

  it('uses the explicit packageName and ignores bundleId (Android)', async () => {
    setPlatform('android');
    const spy = mockFetchFixture('store/playstore.html');
    await expect(
      checkVersion({ version: '1.283.0', bundleId: 'x.y', packageName })
    ).resolves.toMatchObject({ status: 'ready', local: '1.283.0' });
    expect(requestOf(spy).url).toBe(
      'https://play.google.com/store/apps/details?id=com.github.android'
    );
  });

  it('detects the version and the bundleId with expo-application (iOS)', async () => {
    setOptionalModules({
      'expo-application': {
        nativeApplicationVersion: '1.0.0',
        applicationId: 'com.example.app',
      },
    });
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await expect(checkVersion({ country: 'jp' })).resolves.toMatchObject({
      status: 'ready',
      local: '1.0.0',
      remote: '1.283.0',
    });
    expect(requestOf(spy).url).toContain('bundleId=com.example.app&');
  });

  it('detects the version and the package name with react-native-device-info (Android)', async () => {
    setPlatform('android');
    setOptionalModules({
      'react-native-device-info': {
        getVersion: () => '1.283.0',
        getBundleId: () => 'com.github.android',
      },
    });
    const spy = mockFetchFixture('store/playstore.html');
    await expect(checkVersion()).resolves.toMatchObject({
      status: 'ready',
      local: '1.283.0',
      result: 'equal',
    });
    expect(requestOf(spy).url).toBe(
      'https://play.google.com/store/apps/details?id=com.github.android'
    );
  });

  it('prefers the explicit values over the detected ones', async () => {
    setOptionalModules({
      'expo-application': {
        nativeApplicationVersion: '9.9.9',
        applicationId: 'com.example.app',
      },
    });
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.282.0', bundleId })
    ).resolves.toMatchObject({ local: '1.282.0' });
    expect(requestOf(spy).url).toContain(`bundleId=${bundleId}&`);
  });
});

describe('checkVersion: defaults', () => {
  it('defaults country to the region of the device locale', async () => {
    mockLocale('ja-JP');
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await checkVersion({ version: '1.282.0', bundleId });
    expect(requestOf(spy).url).toMatch(/&country=jp&\d+$/);
  });

  it('falls back to us when the locale has no region', async () => {
    mockLocale('ja');
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await checkVersion({ version: '1.282.0', bundleId });
    expect(requestOf(spy).url).toMatch(/&country=us&\d+$/);
  });

  it('uses the country param over the locale', async () => {
    mockLocale('ja-JP');
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await checkVersion({ version: '1.282.0', bundleId, country: 'gb' });
    expect(requestOf(spy).url).toMatch(/&country=gb&\d+$/);
  });

  it('times out after the default timeout (10 seconds) with TIMEOUT', async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10000);
    jest.useFakeTimers();
    const { calls } = mockFetchPending();
    let settled = false;
    const promise = catchError(
      checkVersion({ version: '1.0.0', bundleId: uniqueId() }).finally(() => {
        settled = true;
      })
    );
    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const error = await promise;
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      message: `the version check timed out after ${DEFAULT_TIMEOUT_MS}ms`,
    });
    // fetch を止めるのは次のタスク（request.ts）
    await jest.advanceTimersByTimeAsync(1);
    expect(calls[0].aborted).toBe(true);
  });

  it('uses the timeoutMs param', async () => {
    jest.useFakeTimers();
    const { calls } = mockFetchPending();
    const promise = catchError(
      checkVersion({ version: '1.0.0', bundleId: uniqueId(), timeoutMs: 500 })
    );
    await jest.advanceTimersByTimeAsync(500);
    expect(await promise).toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(1);
    expect(calls[0].aborted).toBe(true);
  });
});

describe('checkVersion: ready', () => {
  it('iOS: returns the comparison with the release notes and the release date of the store', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.282.0', bundleId, country: 'jp' })
    ).resolves.toEqual({
      status: 'ready',
      local: '1.282.0',
      remote: '1.283.0',
      result: 'new',
      detail: 'remote > local',
      diff: 'minor',
      minimum: null,
      belowMinimum: false,
      releaseNotes: iosNotes,
      releaseDate: iosDate,
    });
  });

  it('Android: returns the comparison with the release notes and the release date of the store', async () => {
    setPlatform('android');
    mockFetchFixture('store/playstore.html');
    await expect(
      checkVersion({ version: '1.0.0', packageName })
    ).resolves.toEqual({
      status: 'ready',
      local: '1.0.0',
      remote: '1.283.0',
      result: 'new',
      detail: 'remote > local',
      diff: 'minor',
      minimum: null,
      belowMinimum: false,
      releaseNotes: androidNotes,
      releaseDate: androidDate,
    });
  });

  it.each([
    ['1.283.0', 'equal', 'remote === local'],
    ['2.0.0', 'old', 'remote < local'],
  ])('has no diff when local is %s (%s)', async (version, result, detail) => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({ version, bundleId, country: 'jp' })
    ).resolves.toMatchObject({ result, detail, diff: null });
  });

  it.each(['ios', 'android'] as const)(
    '%s with getLatestVersion: does not fetch the store, and has no release notes or release date',
    async (os) => {
      setPlatform(os);
      const { calls } = mockFetchPending();
      const getLatestVersion = getter('2.0.0');
      await expect(
        checkVersion({
          version: '1.0.0',
          bundleId: uniqueId(),
          packageName: uniqueId(),
          getLatestVersion,
        })
      ).resolves.toEqual({
        status: 'ready',
        local: '1.0.0',
        remote: '2.0.0',
        result: 'new',
        detail: 'remote > local',
        diff: 'major',
        minimum: null,
        belowMinimum: false,
        releaseNotes: undefined,
        releaseDate: undefined,
      });
      // iOS でも、ストアの URL のための iTunes Lookup をしない
      expect(calls).toHaveLength(0);
      expect(getLatestVersion).toHaveBeenCalledWith({
        platform: os,
        signal: expect.any(AbortSignal),
      });
    }
  );

  it.each([
    ['1.282.0', '1.283.0', true],
    ['1.283.0', '1.283.0', false],
    ['1.284.0', '1.283.0', false],
  ])(
    'local %s with minimum %s: belowMinimum is %s',
    async (version, minimum, belowMinimum) => {
      mockFetchFixture('store/itunes-lookup.json');
      await expect(
        checkVersion({
          version,
          bundleId,
          getMinimumVersion: getter(minimum),
        })
      ).resolves.toMatchObject({ minimum, belowMinimum });
    }
  );

  it.each([
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('treats %s from getMinimumVersion as not specified', async (_, value) => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({
        version: '1.0.0',
        bundleId,
        getMinimumVersion: getter(value),
      })
    ).resolves.toMatchObject({ minimum: null, belowMinimum: false });
  });
});

describe('checkVersion: errors', () => {
  it('rejects with LOCAL_VERSION_UNAVAILABLE when the version cannot be detected, without fetching', async () => {
    const { calls } = mockFetchPending();
    const error = await catchError(checkVersion({ bundleId }));
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error).toMatchObject({ code: 'LOCAL_VERSION_UNAVAILABLE' });
    expect(calls).toHaveLength(0);
  });

  it('rejects with LOCAL_VERSION_UNAVAILABLE when the ID cannot be detected', async () => {
    await expect(checkVersion({ version: '1.0.0' })).rejects.toMatchObject({
      name: 'StoreVersionError',
      code: 'LOCAL_VERSION_UNAVAILABLE',
    });
  });

  it('rejects with INVALID_VERSION for a local version that cannot be compared, without fetching', async () => {
    const { calls } = mockFetchPending();
    await expect(
      checkVersion({ version: 'abc', bundleId })
    ).rejects.toMatchObject({
      name: 'StoreVersionError',
      code: 'INVALID_VERSION',
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects with NOT_FOUND when the app is not on the App Store', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    await expect(
      checkVersion({ version: '1.0.0', bundleId })
    ).rejects.toMatchObject({ name: 'StoreVersionError', code: 'NOT_FOUND' });
  });

  // issue #55 / #59: iTunes Lookup がメンテナンス中などに HTML のエラーページを返すと、JSON のパースエラー（SyntaxError）が
  // そのまま届いていた
  it('rejects with NETWORK, not a JSON parse error, when iTunes Lookup returns 503 with an HTML body (#55, #59)', async () => {
    mockFetchResponse(
      '<html><head><title>Service Unavailable</title></head><body>Service Unavailable</body></html>',
      503
    );
    const error = await catchError(
      checkVersion({ version: '1.0.0', bundleId })
    );
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error).toMatchObject({
      code: 'NETWORK',
      message: 'iTunes Lookup responded with status 503',
    });
  });

  it('rejects with LATEST_VERSION_FAILED when getLatestVersion returns an empty value', async () => {
    await expect(
      checkVersion({
        version: '1.0.0',
        bundleId,
        getLatestVersion: getter(''),
      })
    ).rejects.toMatchObject({
      name: 'StoreVersionError',
      code: 'LATEST_VERSION_FAILED',
    });
  });

  it('rejects with INVALID_VERSION for Varies with device', async () => {
    setPlatform('android');
    mockFetchFixture('store/playstore-varies.html');
    await expect(
      checkVersion({ version: '1.0.0', packageName })
    ).rejects.toMatchObject({
      name: 'StoreVersionError',
      code: 'INVALID_VERSION',
    });
  });

  it('rejects with INVALID_VERSION for Varies with device even when local is below the minimum', async () => {
    setPlatform('android');
    mockFetchFixture('store/playstore-varies.html');
    await expect(
      checkVersion({
        version: '1.0.0',
        packageName,
        getMinimumVersion: getter('2.0.0'),
      })
    ).rejects.toMatchObject({
      name: 'StoreVersionError',
      code: 'INVALID_VERSION',
    });
  });

  it('rejects with MINIMUM_VERSION_FAILED when getMinimumVersion throws, even though the latest is known', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    const error = await catchError(
      checkVersion({
        version: '1.0.0',
        bundleId,
        getMinimumVersion: failing(),
      })
    );
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error).toMatchObject({ code: 'MINIMUM_VERSION_FAILED' });
    expect((error as StoreVersionError).cause).toEqual(
      new Error('remote config failed')
    );
  });

  it('rejects with MINIMUM_VERSION_FAILED for a minimum that cannot be compared', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({
        version: '1.0.0',
        bundleId,
        getMinimumVersion: getter('abc'),
      })
    ).rejects.toMatchObject({
      name: 'StoreVersionError',
      code: 'MINIMUM_VERSION_FAILED',
    });
  });

  it.each([
    ['getMinimumVersion throws', failing],
    ['the minimum cannot be compared', () => getter('abc')],
  ])(
    'rejects with INVALID_VERSION, not MINIMUM_VERSION_FAILED, when both fail (Varies and %s)',
    async (_, minimum) => {
      setPlatform('android');
      mockFetchFixture('store/playstore-varies.html');
      await expect(
        checkVersion({
          version: '1.0.0',
          packageName,
          getMinimumVersion: minimum(),
        })
      ).rejects.toMatchObject({
        name: 'StoreVersionError',
        code: 'INVALID_VERSION',
      });
    }
  );
});

// 今の resolve では、errors に INVALID_VERSION と MINIMUM_VERSION_FAILED が同時に入ることは無い
// （最新が比較できないまま判定を続けるのは、最低バージョンが有効で force になるときだけ）。順を固定するために resolve を差し替える
describe('checkVersion: the order of the errors that resolve did not stop at', () => {
  const invalid = new StoreVersionError('INVALID_VERSION', 'latest');
  const minimumFailed = new StoreVersionError(
    'MINIMUM_VERSION_FAILED',
    'minimum'
  );

  const withResolved = (resolved: Partial<ResolveResult>) => {
    const base: ResolveResult = {
      latest: '2.0.0',
      minimum: null,
      storeUrl: null,
      storeUrlResult: new Promise(() => {}),
      result: 'new',
      detail: 'remote > local',
      action: 'none',
      diff: 'major',
      errors: [],
    };
    jest.doMock('../src/resolve.ts', () => ({
      resolve: async () => ({ ...base, ...resolved }),
    }));
    let loaded!: typeof checkVersion;
    jest.isolateModules(() => {
      loaded = require('../src/checkVersion.ts').checkVersion;
    });
    jest.dontMock('../src/resolve.ts');
    return loaded;
  };

  it.each([
    ['minimum first', [minimumFailed, invalid]],
    ['invalid first', [invalid, minimumFailed]],
  ])(
    'rejects with INVALID_VERSION before MINIMUM_VERSION_FAILED (%s in errors)',
    async (_, errors) => {
      const check = withResolved({ errors });
      await expect(check({ version: '1.0.0', bundleId })).rejects.toBe(invalid);
    }
  );

  it('rejects with INVALID_VERSION if resolve has no latest without an error', async () => {
    const check = withResolved({ latest: null, result: null, detail: null });
    await expect(check({ version: '1.0.0', bundleId })).rejects.toMatchObject({
      name: 'StoreVersionError',
      code: 'INVALID_VERSION',
    });
  });
});

describe('checkVersion: signal', () => {
  it('rejects with the same object as signal.reason when aborted during the fetch', async () => {
    const { calls } = mockFetchPending();
    const controller = new AbortController();
    const reason = { why: 'cancelled by the app' };
    const promise = catchError(
      checkVersion({
        version: '1.0.0',
        bundleId: uniqueId(),
        signal: controller.signal,
      })
    );
    controller.abort(reason);
    expect(await promise).toBe(reason);
    expect(calls).toHaveLength(1);
  });

  it('rejects with the default reason of abort() (not a StoreVersionError)', async () => {
    mockFetchPending();
    const controller = new AbortController();
    const promise = catchError(
      checkVersion({
        version: '1.0.0',
        bundleId: uniqueId(),
        signal: controller.signal,
      })
    );
    controller.abort();
    const error = await promise;
    expect(error).toBe(controller.signal.reason);
    expect(error).not.toBeInstanceOf(StoreVersionError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('rejects with signal.reason at once for an aborted signal, without fetching', async () => {
    const { calls } = mockFetchPending();
    const controller = new AbortController();
    const reason = new Error('already cancelled');
    controller.abort(reason);
    await expect(
      checkVersion({ version: '1.0.0', bundleId, signal: controller.signal })
    ).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
  });

  it('aborts getLatestVersion with the signal', async () => {
    const controller = new AbortController();
    const getLatestVersion = jest.fn<
      ReturnType<VersionGetter>,
      Parameters<VersionGetter>
    >(() => new Promise(() => {}));
    const reason = new Error('cancelled');
    const promise = catchError(
      checkVersion({
        version: '1.0.0',
        bundleId,
        getLatestVersion,
        signal: controller.signal,
      })
    );
    controller.abort(reason);
    expect(await promise).toBe(reason);
    expect(getLatestVersion.mock.calls[0][0].signal.aborted).toBe(true);
  });

  // 古い Hermes の AbortSignal は reason を持たない
  it('rejects with an AbortError when the signal has no reason', async () => {
    mockFetchPending();
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (_: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: () => void) => {
        listeners.delete(listener);
      },
    };
    const promise = catchError(
      checkVersion({
        version: '1.0.0',
        bundleId: uniqueId(),
        signal: signal as unknown as AbortSignal,
      })
    );
    signal.aborted = true;
    for (const listener of listeners) {
      listener();
    }
    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(StoreVersionError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });
});
