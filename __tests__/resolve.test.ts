import { StoreVersionError } from '../src/errors.ts';
import type { VersionGetter } from '../src/fetchers/custom.ts';
import { isAbortError } from '../src/request.ts';
import {
  attachedErrorsOf,
  type ResolveParams,
  resolve,
} from '../src/resolve.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  mockFetchReject,
  mockFetchResponse,
  readFixture,
  requestOf,
} from './__helpers__/fetch.ts';

const trackViewUrl = 'https://apps.apple.com/jp/app/github/id1477376905?uo=4';
const playUrl =
  'https://play.google.com/store/apps/details?id=com.github.android';

// request.ts は取得中の Promise をモジュールの中で共有するので、保留の fetch を使うテストは ID を変えて混ざらないようにする
let seq = 0;
const uniqueId = () => {
  seq += 1;
  return `com.example.resolve${seq}`;
};

const ios = (overrides: Partial<ResolveParams> = {}): ResolveParams => ({
  platform: 'ios',
  version: '1.282.0',
  appId: 'com.github.stormbreaker.prod',
  country: 'jp',
  ...overrides,
});

const android = (overrides: Partial<ResolveParams> = {}): ResolveParams => ({
  platform: 'android',
  version: '1.282.0',
  appId: 'com.github.android',
  country: 'jp',
  ...overrides,
});

// 次のタスクまで待つ（保留中の Promise の後続が走りきるように）
const nextTask = () =>
  new Promise<void>((r) => {
    setTimeout(() => r(), 0);
  });

const catchError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as StoreVersionError;
  }
  throw new Error('did not reject');
};

const getter = (value: string | null | undefined) =>
  jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(
    async () => value
  );

const never = () =>
  jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(
    () => new Promise(() => {})
  );

describe('resolve: store only (no getters)', () => {
  it('iOS: uses the lookup version, trackViewUrl and releaseNotes', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const result = await resolve(ios());
    expect(result).toEqual({
      latest: '1.283.0',
      minimum: null,
      storeUrl: trackViewUrl,
      storeUrlResult: expect.any(Promise),
      releaseNotes: "What's new\n\n…",
      result: 'new',
      detail: 'remote > local',
      action: 'warning',
      diff: 'minor',
      errors: [],
    });
    await expect(result.storeUrlResult).resolves.toEqual({
      storeUrl: trackViewUrl,
      error: null,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(requestOf(spy).url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?bundleId=com\.github\.stormbreaker\.prod&country=jp&\d+$/
    );
  });

  it('Android: extracts the version from the page and builds the store URL', async () => {
    const spy = mockFetchFixture('store/playstore.html');
    const result = await resolve(android({ version: '1.283.0' }));
    expect(result).toMatchObject({
      latest: '1.283.0',
      minimum: null,
      storeUrl: playUrl,
      result: 'equal',
      detail: 'remote === local',
      action: 'none',
      diff: null,
      errors: [],
    });
    expect(result.releaseNotes).toBeUndefined();
    await expect(result.storeUrlResult).resolves.toEqual({
      storeUrl: playUrl,
      error: null,
    });
    expect(requestOf(spy).url).toBe(playUrl);
  });

  it('applies the policy to action only (result / detail stay as v1)', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(resolve(ios({ policy: 'force' }))).resolves.toMatchObject({
      result: 'new',
      detail: 'remote > local',
      action: 'force',
      diff: 'minor',
    });
  });

  it('iOS: returns STORE_URL_UNAVAILABLE in storeUrlResult when the lookup has no trackViewUrl', async () => {
    mockFetchResponse('{"results":[{"version":"1.0.0"}]}');
    const result = await resolve(ios({ version: '1.0.0' }));
    expect(result.storeUrl).toBeNull();
    expect((await result.storeUrlResult).error).toMatchObject({
      code: 'STORE_URL_UNAVAILABLE',
    });
  });
});

describe('resolve: getLatestVersion / getMinimumVersion', () => {
  it('latest only (iOS): uses the getter value, not the lookup version, and looks up only for the URL', async () => {
    const { calls } = mockFetchPending();
    const getLatestVersion = getter('2.0.0');
    const appId = uniqueId();
    const result = await resolve(ios({ appId, getLatestVersion }));
    // 判定は URL の lookup を待たずに返る
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`bundleId=${appId}&`);
    expect(result).toMatchObject({
      latest: '2.0.0',
      storeUrl: null,
      result: 'new',
      action: 'force',
      diff: 'major',
      errors: [],
    });
    expect(result.releaseNotes).toBeUndefined();
    // lookup が返す version（1.283.0）は使わない
    calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    await expect(result.storeUrlResult).resolves.toEqual({
      storeUrl: trackViewUrl,
      error: null,
    });
    expect(getLatestVersion).toHaveBeenCalledWith({
      platform: 'ios',
      signal: expect.any(AbortSignal),
    });
  });

  it('latest only (iOS): fills storeUrl when the lookup finished before the judgment', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    let release: (v: string) => void = () => {};
    const getLatestVersion: VersionGetter = () =>
      new Promise((r) => {
        release = r;
      });
    const promise = resolve(ios({ getLatestVersion }));
    await nextTask();
    release('1.282.0');
    const result = await promise;
    expect(result).toMatchObject({
      latest: '1.282.0',
      storeUrl: trackViewUrl,
      result: 'equal',
      action: 'none',
    });
    expect(result.releaseNotes).toBeUndefined();
  });

  it('latest only (iOS): a failed URL lookup does not fail the judgment', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    const result = await resolve(
      ios({ appId: uniqueId(), getLatestVersion: getter('1.282.0') })
    );
    expect(result).toMatchObject({ result: 'equal', action: 'none' });
    const url = await result.storeUrlResult;
    expect(url.storeUrl).toBeNull();
    expect(url.error).toMatchObject({ code: 'STORE_URL_UNAVAILABLE' });
    expect(url.error?.cause).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('latest only (Android): does not fetch the Play Store', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const getLatestVersion = getter('1.283.0');
    const result = await resolve(android({ getLatestVersion }));
    expect(spy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      latest: '1.283.0',
      storeUrl: playUrl,
      result: 'new',
      action: 'warning',
    });
    await expect(result.storeUrlResult).resolves.toEqual({
      storeUrl: playUrl,
      error: null,
    });
    expect(getLatestVersion).toHaveBeenCalledWith({
      platform: 'android',
      signal: expect.any(AbortSignal),
    });
  });

  it('minimum only: forces when local is below the minimum', async () => {
    mockFetchFixture('store/playstore.html');
    const getMinimumVersion = getter('1.283.0');
    await expect(
      resolve(android({ getMinimumVersion }))
    ).resolves.toMatchObject({
      latest: '1.283.0',
      minimum: '1.283.0',
      result: 'new',
      diff: 'minor',
      action: 'force',
      errors: [],
    });
  });

  it('minimum only: treats an empty value as not specified', async () => {
    mockFetchFixture('store/playstore.html');
    await expect(
      resolve(android({ getMinimumVersion: getter('') }))
    ).resolves.toMatchObject({ minimum: null, action: 'warning', errors: [] });
  });

  it('both: calls them in parallel with the same signal and judges with both', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    let releaseLatest: (v: string) => void = () => {};
    const getLatestVersion = jest.fn<
      ReturnType<VersionGetter>,
      Parameters<VersionGetter>
    >(
      () =>
        new Promise((r) => {
          releaseLatest = r;
        })
    );
    const getMinimumVersion = getter('1.0.0');
    const promise = resolve(
      android({ version: '1.5.0', getLatestVersion, getMinimumVersion })
    );
    // latest を待たずに minimum も呼ばれている
    expect(getLatestVersion).toHaveBeenCalledTimes(1);
    expect(getMinimumVersion).toHaveBeenCalledTimes(1);
    expect(getMinimumVersion.mock.calls[0][0].signal).toBe(
      getLatestVersion.mock.calls[0][0].signal
    );
    releaseLatest('1.5.1');
    await expect(promise).resolves.toMatchObject({
      latest: '1.5.1',
      minimum: '1.0.0',
      result: 'new',
      diff: 'patch',
      action: 'warning',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('both: the minimum forces even when the latest is equal', async () => {
    await expect(
      resolve(
        android({
          version: '1.0.0',
          getLatestVersion: getter('1.0.0'),
          getMinimumVersion: getter('1.1.0'),
        })
      )
    ).resolves.toMatchObject({ result: 'equal', action: 'force' });
  });

  it('both (iOS): the judgment returns while the URL lookup is pending, and the minimum forces', async () => {
    const { calls } = mockFetchPending();
    const appId = uniqueId();
    const result = await resolve(
      ios({
        appId,
        version: '1.282.0',
        getLatestVersion: getter('1.282.0'),
        getMinimumVersion: getter('1.283.0'),
      })
    );
    expect(result).toMatchObject({
      latest: '1.282.0',
      minimum: '1.283.0',
      storeUrl: null,
      result: 'equal',
      action: 'force',
      errors: [],
    });
    expect(result.releaseNotes).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`bundleId=${appId}&`);
    calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    await expect(result.storeUrlResult).resolves.toEqual({
      storeUrl: trackViewUrl,
      error: null,
    });
  });

  it('store and minimum run in parallel', async () => {
    const { calls } = mockFetchPending();
    const getMinimumVersion = getter('1.0.0');
    const promise = resolve(android({ appId: uniqueId(), getMinimumVersion }));
    expect(calls).toHaveLength(1);
    expect(getMinimumVersion).toHaveBeenCalledTimes(1);
    calls[0].respond({ body: readFixture('store/playstore.html') });
    await expect(promise).resolves.toMatchObject({ action: 'warning' });
  });
});

describe('resolve: failures of the getters', () => {
  it('rejects with LATEST_VERSION_FAILED and does not fall back to the store (Android)', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const error = await catchError(
      resolve(
        android({
          getLatestVersion: async () => Promise.reject(new Error('boom')),
        })
      )
    );
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('LATEST_VERSION_FAILED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects with LATEST_VERSION_FAILED for an empty value (iOS), without using the version of the URL lookup', async () => {
    // URL の lookup は 1.283.0 を返すが、getLatestVersion の失敗をそれで補わない（ストアにフォールバックしない）
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const error = await catchError(
      resolve(ios({ appId: uniqueId(), getLatestVersion: getter('') }))
    );
    expect(error).toMatchObject({
      code: 'LATEST_VERSION_FAILED',
      message: 'getLatestVersion returned an empty string',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(requestOf(spy).url).toContain('bundleId=');
  });

  it('stops the URL lookup when the judgment fails (iOS)', async () => {
    const { calls } = mockFetchPending();
    await catchError(
      resolve(ios({ appId: uniqueId(), getLatestVersion: getter('') }))
    );
    expect(calls).toHaveLength(1);
    // 判定をやめたので、URL の lookup も止める（次のタスクで fetch が abort される）
    await nextTask();
    expect(calls[0].aborted).toBe(true);
  });

  it('keeps comparing with the latest when getMinimumVersion throws (MINIMUM_VERSION_FAILED in errors)', async () => {
    mockFetchFixture('store/playstore.html');
    const cause = new Error('remote config failed');
    const result = await resolve(
      android({ getMinimumVersion: async () => Promise.reject(cause) })
    );
    expect(result).toMatchObject({
      latest: '1.283.0',
      minimum: null,
      result: 'new',
      action: 'warning',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'MINIMUM_VERSION_FAILED' });
    expect(result.errors[0].cause).toBe(cause);
  });

  it('keeps comparing when getMinimumVersion returns a non-string', async () => {
    const result = await resolve(
      ios({
        getLatestVersion: getter('1.282.0'),
        getMinimumVersion: async () => 1 as unknown as string,
      })
    );
    expect(result).toMatchObject({ result: 'equal', action: 'none' });
    expect(result.errors.map((e) => e.code)).toEqual([
      'MINIMUM_VERSION_FAILED',
    ]);
  });

  it('skips a non-comparable minimum and reports it (D46 ②)', async () => {
    mockFetchFixture('store/playstore.html');
    const result = await resolve(android({ getMinimumVersion: getter('abc') }));
    expect(result).toMatchObject({
      minimum: 'abc',
      result: 'new',
      action: 'warning',
    });
    expect(result.errors.map((e) => [e.code, e.message])).toEqual([
      ['MINIMUM_VERSION_FAILED', 'minimum version is invalid: "abc"'],
    ]);
  });
});

describe('resolve: versions that cannot be compared', () => {
  it('rejects with INVALID_VERSION for Varies with device (real fixture)', async () => {
    mockFetchFixture('store/playstore-varies.html');
    const error = await catchError(resolve(android()));
    expect(error.code).toBe('INVALID_VERSION');
    expect(error.message).toContain('Varies with device');
    expect(attachedErrorsOf(error)).toEqual([]);
  });

  it('rejects with INVALID_VERSION for a non-numeric versionName (real fixture)', async () => {
    mockFetchFixture('store/playstore-nonnumeric.html');
    const error = await catchError(
      resolve(android({ getMinimumVersion: getter('1.0.0') }))
    );
    expect(error).toMatchObject({
      code: 'INVALID_VERSION',
      message: 'remote version is invalid: "50616-r-2026-11-03"',
    });
  });

  it('forces with INVALID_VERSION in errors when the latest is Varies but local < a valid minimum (D46 ③)', async () => {
    mockFetchFixture('store/playstore-varies.html');
    const result = await resolve(
      android({ getMinimumVersion: getter('2.0.0') })
    );
    expect(result).toMatchObject({
      latest: null,
      minimum: '2.0.0',
      storeUrl: playUrl,
      result: null,
      detail: null,
      diff: null,
      action: 'force',
    });
    expect(result.errors.map((e) => e.code)).toEqual(['INVALID_VERSION']);
    expect(result.errors[0].message).toContain('Varies with device');
  });

  it('forces with INVALID_VERSION in errors for a non-comparable getLatestVersion value below a valid minimum', async () => {
    const result = await resolve(
      android({
        getLatestVersion: getter('latest'),
        getMinimumVersion: getter('2.0.0'),
      })
    );
    expect(result).toMatchObject({
      latest: 'latest',
      result: null,
      action: 'force',
    });
    expect(result.errors.map((e) => [e.code, e.message])).toEqual([
      ['INVALID_VERSION', 'remote version is invalid: "latest"'],
    ]);
  });

  it('attaches MINIMUM_VERSION_FAILED to the INVALID_VERSION when both are invalid (D46)', async () => {
    const error = await catchError(
      resolve(
        android({
          getLatestVersion: getter('latest'),
          getMinimumVersion: getter('minimum'),
        })
      )
    );
    expect(error).toMatchObject({
      code: 'INVALID_VERSION',
      message: 'remote version is invalid: "latest"',
    });
    expect(attachedErrorsOf(error).map((e) => [e.code, e.message])).toEqual([
      ['MINIMUM_VERSION_FAILED', 'minimum version is invalid: "minimum"'],
    ]);
  });

  it('attaches MINIMUM_VERSION_FAILED from a failed getter when the latest is invalid', async () => {
    mockFetchFixture('store/playstore-varies.html');
    const error = await catchError(
      resolve(
        android({
          getMinimumVersion: async () => Promise.reject(new Error('x')),
        })
      )
    );
    expect(error.code).toBe('INVALID_VERSION');
    expect(attachedErrorsOf(error).map((e) => e.code)).toEqual([
      'MINIMUM_VERSION_FAILED',
    ]);
  });

  it('rejects with INVALID_VERSION for an invalid local version before fetching', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const getLatestVersion = getter('1.0.0');
    const error = await catchError(
      resolve(ios({ version: 'abc', getLatestVersion }))
    );
    expect(error).toMatchObject({
      code: 'INVALID_VERSION',
      message: 'local version is invalid: "abc"',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(getLatestVersion).not.toHaveBeenCalled();
  });

  it('returns an empty list from attachedErrorsOf for other values', () => {
    expect(attachedErrorsOf(new Error('x'))).toEqual([]);
    expect(attachedErrorsOf(null)).toEqual([]);
    expect(attachedErrorsOf('x')).toEqual([]);
  });
});

describe('resolve: minimum errors attached to a failed latest', () => {
  const failingMinimum = () =>
    jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(async () =>
      Promise.reject(new Error('remote config failed'))
    );

  it('attaches the failure of getMinimumVersion that finished before the store failed (NETWORK)', async () => {
    const { calls } = mockFetchPending();
    const promise = catchError(
      resolve(
        android({ appId: uniqueId(), getMinimumVersion: failingMinimum() })
      )
    );
    await nextTask();
    calls[0].fail(new TypeError('Network request failed'));
    const error = await promise;
    expect(error.code).toBe('NETWORK');
    expect(attachedErrorsOf(error).map((e) => [e.code, e.message])).toEqual([
      ['MINIMUM_VERSION_FAILED', 'getMinimumVersion threw'],
    ]);
  });

  it('attaches a non-comparable minimum that finished before the store failed (NOT_FOUND)', async () => {
    const { calls } = mockFetchPending();
    const promise = catchError(
      resolve(ios({ appId: uniqueId(), getMinimumVersion: getter('abc') }))
    );
    await nextTask();
    calls[0].respond({ body: readFixture('store/itunes-lookup-empty.json') });
    const error = await promise;
    expect(error.code).toBe('NOT_FOUND');
    expect(attachedErrorsOf(error).map((e) => [e.code, e.message])).toEqual([
      ['MINIMUM_VERSION_FAILED', 'minimum version is invalid: "abc"'],
    ]);
  });

  it('attaches it to PARSE_FAILED', async () => {
    const { calls } = mockFetchPending();
    const promise = catchError(
      resolve(android({ appId: uniqueId(), getMinimumVersion: getter('abc') }))
    );
    await nextTask();
    calls[0].respond({ body: readFixture('store/playstore-changed.html') });
    const error = await promise;
    expect(error.code).toBe('PARSE_FAILED');
    expect(attachedErrorsOf(error).map((e) => e.code)).toEqual([
      'MINIMUM_VERSION_FAILED',
    ]);
  });

  it('attaches it to LATEST_VERSION_FAILED', async () => {
    let fail: (e: unknown) => void = () => {};
    const promise = catchError(
      resolve(
        android({
          getLatestVersion: () =>
            new Promise((_, reject) => {
              fail = reject;
            }),
          getMinimumVersion: failingMinimum(),
        })
      )
    );
    await nextTask();
    fail(new Error('latest failed'));
    const error = await promise;
    expect(error.code).toBe('LATEST_VERSION_FAILED');
    expect(attachedErrorsOf(error).map((e) => e.code)).toEqual([
      'MINIMUM_VERSION_FAILED',
    ]);
  });

  it('attaches it to TIMEOUT when the minimum failed before the deadline', async () => {
    jest.useFakeTimers();
    const promise = catchError(
      resolve(
        android({
          getLatestVersion: never(),
          getMinimumVersion: failingMinimum(),
          timeoutMs: 500,
        })
      )
    );
    await jest.advanceTimersByTimeAsync(500);
    const error = await promise;
    expect(error.code).toBe('TIMEOUT');
    expect(attachedErrorsOf(error).map((e) => e.code)).toEqual([
      'MINIMUM_VERSION_FAILED',
    ]);
  });

  it('attaches nothing when the minimum was valid', async () => {
    const { calls } = mockFetchPending();
    const promise = catchError(
      resolve(
        android({ appId: uniqueId(), getMinimumVersion: getter('1.0.0') })
      )
    );
    await nextTask();
    calls[0].fail(new TypeError('Network request failed'));
    expect(attachedErrorsOf(await promise)).toEqual([]);
  });

  it('does not wait for a minimum that has not finished', async () => {
    const getMinimumVersion = never();
    const { calls } = mockFetchPending();
    const promise = catchError(
      resolve(android({ appId: uniqueId(), getMinimumVersion }))
    );
    await nextTask();
    calls[0].fail(new TypeError('Network request failed'));
    const error = await promise;
    expect(error.code).toBe('NETWORK');
    expect(attachedErrorsOf(error)).toEqual([]);
    expect(getMinimumVersion.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('does not attach the rejection of a getMinimumVersion that honors the signal and was aborted by the timeout', async () => {
    jest.useFakeTimers();
    // signal を fetch に渡したときのように、abort されると自分から reject する getter
    const honoring: VersionGetter = ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      });
    const promise = catchError(
      resolve(
        android({
          getLatestVersion: never(),
          getMinimumVersion: honoring,
          timeoutMs: 500,
        })
      )
    );
    await jest.advanceTimersByTimeAsync(500);
    const error = await promise;
    expect(error.code).toBe('TIMEOUT');
    expect(attachedErrorsOf(error)).toEqual([]);
  });

  it('does not attach the timeout of the minimum itself to TIMEOUT', async () => {
    jest.useFakeTimers();
    const promise = catchError(
      resolve(
        android({
          getLatestVersion: never(),
          getMinimumVersion: never(),
          timeoutMs: 500,
        })
      )
    );
    await jest.advanceTimersByTimeAsync(500);
    const error = await promise;
    expect(error.code).toBe('TIMEOUT');
    expect(attachedErrorsOf(error)).toEqual([]);
  });
});

describe('resolve: policy', () => {
  it.each([['always'], [{ major: 'block' }], [1]])(
    'rejects an invalid policy value %p with POLICY_FAILED before fetching, even without a difference',
    async (policy) => {
      const spy = jest.spyOn(globalThis, 'fetch');
      const error = await catchError(
        resolve(ios({ policy: policy as never, version: '1.283.0' }))
      );
      expect(error.code).toBe('POLICY_FAILED');
      expect(spy).not.toHaveBeenCalled();
    }
  );

  it('rejects with POLICY_FAILED when the policy function throws, with an invalid minimum attached', async () => {
    const error = await catchError(
      resolve(
        android({
          version: '1.0.0',
          getLatestVersion: getter('2.0.0'),
          getMinimumVersion: getter('bad'),
          policy: () => {
            throw new Error('policy bug');
          },
        })
      )
    );
    expect(error.code).toBe('POLICY_FAILED');
    expect(attachedErrorsOf(error).map((e) => e.code)).toEqual([
      'MINIMUM_VERSION_FAILED',
    ]);
  });

  it('passes local and the latest to the policy function', async () => {
    const policy = jest.fn(() => 'none' as const);
    await expect(
      resolve(
        android({
          version: '1.0.0',
          getLatestVersion: getter('1.1.0'),
          policy,
        })
      )
    ).resolves.toMatchObject({ result: 'new', action: 'none' });
    expect(policy).toHaveBeenCalledWith('1.0.0', '1.1.0');
  });
});

describe('resolve: store errors', () => {
  it('rejects with NOT_FOUND when the app is not on the App Store (real fixture)', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    expect((await catchError(resolve(ios()))).code).toBe('NOT_FOUND');
  });

  it('rejects with PARSE_FAILED for a changed Play page (real fixture)', async () => {
    mockFetchFixture('store/playstore-changed.html');
    expect((await catchError(resolve(android()))).code).toBe('PARSE_FAILED');
  });

  it('rejects with NETWORK on a network error', async () => {
    mockFetchReject(new TypeError('Network request failed'));
    expect((await catchError(resolve(android()))).code).toBe('NETWORK');
  });
});

describe('resolve: timeout and abort', () => {
  it('rejects with TIMEOUT when the store does not answer in time, and stops the fetch', async () => {
    jest.useFakeTimers();
    const { calls } = mockFetchPending();
    const promise = catchError(
      resolve(android({ appId: uniqueId(), timeoutMs: 10000 }))
    );
    await jest.advanceTimersByTimeAsync(9999);
    expect(calls[0].aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const error = await promise;
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      message: 'the version check timed out after 10000ms',
    });
    // fetch を止めるのは次のタスク（request.ts）。偽のタイマーは、タイマーの中で作った 0ms のタイマーを 1ms 後に回す
    await jest.advanceTimersByTimeAsync(1);
    expect(calls[0].aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out a getter that ignores the signal, and aborts the signal', async () => {
    jest.useFakeTimers();
    const getLatestVersion = never();
    const promise = catchError(
      resolve(android({ getLatestVersion, timeoutMs: 500 }))
    );
    await jest.advanceTimersByTimeAsync(500);
    expect((await promise).code).toBe('TIMEOUT');
    expect(getLatestVersion.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('applies the same timeout to getMinimumVersion: when the latest is in time, skips only the minimum (MINIMUM_VERSION_FAILED with TIMEOUT as the cause)', async () => {
    jest.useFakeTimers();
    const getMinimumVersion = never();
    const promise = resolve(
      android({
        version: '1.0.0',
        getLatestVersion: getter('1.1.0'),
        getMinimumVersion,
        timeoutMs: 500,
      })
    );
    await jest.advanceTimersByTimeAsync(499);
    expect(getMinimumVersion.mock.calls[0][0].signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result).toMatchObject({
      latest: '1.1.0',
      minimum: null,
      result: 'new',
      diff: 'minor',
      action: 'warning',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'MINIMUM_VERSION_FAILED',
      message: 'getMinimumVersion timed out after 500ms',
    });
    expect(result.errors[0].cause).toMatchObject({
      code: 'TIMEOUT',
      message: 'the version check timed out after 500ms',
    });
    expect(getMinimumVersion.mock.calls[0][0].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('applies the same timeout to getMinimumVersion with the store as the latest', async () => {
    jest.useFakeTimers();
    mockFetchFixture('store/playstore.html');
    const result = resolve(
      android({ getMinimumVersion: never(), timeoutMs: 500 })
    );
    await jest.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toMatchObject({
      latest: '1.283.0',
      action: 'warning',
      errors: [expect.objectContaining({ code: 'MINIMUM_VERSION_FAILED' })],
    });
  });

  it('rejects with TIMEOUT when the latest is not in time, even if the minimum is', async () => {
    jest.useFakeTimers();
    const getLatestVersion = never();
    const promise = catchError(
      resolve(
        android({
          getLatestVersion,
          getMinimumVersion: getter('1.0.0'),
          timeoutMs: 500,
        })
      )
    );
    await jest.advanceTimersByTimeAsync(500);
    expect(await promise).toMatchObject({ code: 'TIMEOUT' });
    expect(getLatestVersion.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('rejects with TIMEOUT when neither is in time', async () => {
    jest.useFakeTimers();
    const getMinimumVersion = never();
    const promise = catchError(
      resolve(
        android({
          getLatestVersion: never(),
          getMinimumVersion,
          timeoutMs: 500,
        })
      )
    );
    await jest.advanceTimersByTimeAsync(500);
    expect(await promise).toMatchObject({ code: 'TIMEOUT' });
    expect(getMinimumVersion.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('rejects with AbortError when the caller aborts while only the minimum is pending', async () => {
    const controller = new AbortController();
    const getMinimumVersion = never();
    const promise = catchError(
      resolve(
        android({
          getLatestVersion: getter('1.0.0'),
          getMinimumVersion,
          signal: controller.signal,
        })
      )
    );
    await nextTask();
    controller.abort();
    expect(isAbortError(await promise)).toBe(true);
    expect(getMinimumVersion.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('does not time out without timeoutMs', async () => {
    jest.useFakeTimers();
    let release: (v: string) => void = () => {};
    const promise = resolve(
      android({
        getLatestVersion: () =>
          new Promise((r) => {
            release = r;
          }),
      })
    );
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    release('1.282.0');
    await expect(promise).resolves.toMatchObject({ result: 'equal' });
  });

  it('clears the timer once judged', async () => {
    jest.useFakeTimers();
    await resolve(android({ getLatestVersion: getter('1.0.0'), timeoutMs: 1 }));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the timeout for the iOS URL lookup after the judgment and reports TIMEOUT as its cause', async () => {
    jest.useFakeTimers();
    const { calls } = mockFetchPending();
    const result = await resolve(
      ios({
        appId: uniqueId(),
        getLatestVersion: getter('1.282.0'),
        timeoutMs: 1000,
      })
    );
    expect(result.storeUrl).toBeNull();
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1000);
    const url = await result.storeUrlResult;
    expect(url.error).toMatchObject({ code: 'STORE_URL_UNAVAILABLE' });
    expect(url.error?.cause).toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(1);
    expect(calls[0].aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ends the iOS URL lookup with STORE_URL_UNAVAILABLE (cause AbortError) when the caller aborts after the judgment', async () => {
    const { calls } = mockFetchPending();
    const controller = new AbortController();
    const result = await resolve(
      ios({
        appId: uniqueId(),
        getLatestVersion: getter('1.282.0'),
        signal: controller.signal,
      })
    );
    controller.abort();
    const url = await result.storeUrlResult;
    expect(url.error).toMatchObject({ code: 'STORE_URL_UNAVAILABLE' });
    expect(isAbortError(url.error?.cause)).toBe(true);
    await nextTask();
    expect(calls[0].aborted).toBe(true);
  });

  it('rejects with AbortError when the caller aborts, and aborts the getter signal', async () => {
    const controller = new AbortController();
    const getLatestVersion = never();
    const promise = catchError(
      resolve(android({ getLatestVersion, signal: controller.signal }))
    );
    controller.abort();
    expect(isAbortError(await promise)).toBe(true);
    expect(getLatestVersion.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it('rejects with AbortError at once for an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const getLatestVersion = getter('1.0.0');
    expect(
      isAbortError(
        await catchError(
          resolve(android({ getLatestVersion, signal: controller.signal }))
        )
      )
    ).toBe(true);
    expect(getLatestVersion).not.toHaveBeenCalled();
  });

  it('shares the store fetch between overlapping checks, and the first abort does not stop the second (StrictMode)', async () => {
    jest.useFakeTimers();
    const { spy, calls } = mockFetchPending();
    const appId = uniqueId();
    const first = new AbortController();
    const a = catchError(resolve(android({ appId, signal: first.signal })));
    first.abort();
    const b = resolve(android({ appId }));
    await jest.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(calls[0].aborted).toBe(false);
    calls[0].respond({ body: readFixture('store/playstore.html') });
    await expect(b).resolves.toMatchObject({ latest: '1.283.0' });
    expect(isAbortError(await a)).toBe(true);
  });
});
