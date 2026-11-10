// StoreVersionProvider: 状態の遷移、状態ごとの status / result / onError、取り直す契機（マウント・recheck・復帰）、
// 判定中のバックグラウンド、アンマウント、policy の変更、dismiss、openStore、country の既定。
// fetch はモックし、実ストアにはアクセスしない。デフォルト UI のテストは別ファイルなので、状態は hook を呼ぶだけの Probe で見る
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Text } from 'react-native';

import { StoreVersionError } from '../../src/errors.ts';
import type { VersionGetter } from '../../src/fetchers/custom.ts';
import {
  DEFAULT_TIMEOUT_MS,
  defaultCountry,
  StoreVersionProvider,
  type StoreVersionProviderProps,
} from '../../src/react/StoreVersionProvider.tsx';
import { type AppStateMock, mockAppState } from '../__helpers__/appState.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  mockFetchReject,
  mockFetchResponse,
  readFixture,
  requestOf,
} from '../__helpers__/fetch.ts';
import { mockOpenURL } from '../__helpers__/linking.ts';
import { setOptionalModules } from '../__helpers__/modules.ts';
import { setPlatform } from '../__helpers__/platform.ts';
import {
  codesOf,
  createOnError,
  createOnResult,
  createProbe,
  type Probe,
  renderProvider,
} from '../__helpers__/provider.tsx';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('../__helpers__/platform').platformModule
);

const trackViewUrl = 'https://apps.apple.com/jp/app/github/id1477376905?uo=4';
const playUrl =
  'https://play.google.com/store/apps/details?id=com.github.android';

// request.ts は取得中の fetch をモジュールの中で共有するので、保留の fetch を使うテストは ID を変えて混ざらないようにする
let seq = 0;
const uniqueId = () => {
  seq += 1;
  return `com.example.provider${seq}`;
};

// 次のタスクまで待つ（request.ts は待つ人が全員抜けた fetch を次のタスクで止める）
const nextTask = () =>
  new Promise<void>((r) => {
    setTimeout(() => r(), 0);
  });

// fixture の iOS（1.283.0）/ Android（1.283.0）に対して、local 1.282.0 は minor の差分（既定の policy で warning）
const ios = (
  overrides: Partial<StoreVersionProviderProps> = {}
): StoreVersionProviderProps => ({
  version: '1.282.0',
  bundleId: 'com.github.stormbreaker.prod',
  country: 'jp',
  ...overrides,
});

const android = (
  overrides: Partial<StoreVersionProviderProps> = {}
): StoreVersionProviderProps => ({
  version: '1.282.0',
  packageName: 'com.github.android',
  ...overrides,
});

const lookupBody = (version: string) =>
  JSON.stringify({
    resultCount: 1,
    results: [{ version, trackViewUrl, releaseNotes: 'notes' }],
  });

const getter = (value: string | null | undefined) =>
  jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(
    async () => value
  );

const never = () =>
  jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(
    () => new Promise(() => {})
  );

const failing = (error: unknown = new Error('boom')) =>
  jest.fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>(async () => {
    throw error;
  });

// 判定の結果の列（ready 以外では null）
const verdictOf = (probe: Probe) => {
  const { status, result, detail, action, diff, remote } = probe.current;
  return { status, result, detail, action, diff, remote };
};

const NO_VERDICT = {
  result: null,
  detail: null,
  action: null,
  diff: null,
  remote: null,
};

let appState: AppStateMock;
let probe: Probe;

beforeEach(() => {
  setPlatform('ios');
  appState = mockAppState();
  probe = createProbe();
});

const waitForStatus = async (status: string) => {
  await waitFor(() => expect(probe.current.status).toBe(status));
};

describe('StoreVersionProvider: state transitions', () => {
  it('renders the children without waiting for the check', async () => {
    const { calls } = mockFetchPending();
    await renderProvider(
      ios({ bundleId: uniqueId(), onError: createOnError() }),
      probe,
      <Text>child</Text>
    );
    expect(screen.getByText('child')).toBeOnTheScreen();
    expect(probe.current.status).toBe('checking');
    expect(calls).toHaveLength(1);
  });

  it('goes idle → checking → ready and fills the verdict (iOS store)', async () => {
    const { calls } = mockFetchPending();
    const onResult = createOnResult();
    const onError = createOnError();
    await renderProvider(
      ios({ bundleId: uniqueId(), onResult, onError }),
      probe
    );
    expect(probe.history[0].status).toBe('idle');
    expect(probe.current).toMatchObject({
      status: 'checking',
      local: '1.282.0',
      ...NO_VERDICT,
      storeUrl: null,
      releaseNotes: undefined,
      error: null,
      dismissed: false,
    });
    expect(calls[0].url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?bundleId=com\.example\.provider\d+&country=jp&\d+$/
    );

    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitForStatus('ready');
    expect(probe.statuses()).toEqual(['idle', 'checking', 'ready']);
    expect(probe.current).toMatchObject({
      status: 'ready',
      result: 'new',
      detail: 'remote > local',
      action: 'warning',
      diff: 'minor',
      dismissed: false,
      local: '1.282.0',
      remote: '1.283.0',
      storeUrl: trackViewUrl,
      releaseNotes: "What's new\n\n…",
      error: null,
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('Android: ready with the Play Store URL and no releaseNotes', async () => {
    setPlatform('android');
    const spy = mockFetchFixture('store/playstore.html');
    await renderProvider(android({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    expect(probe.current).toMatchObject({
      result: 'new',
      action: 'warning',
      remote: '1.283.0',
      storeUrl: playUrl,
      releaseNotes: undefined,
    });
    expect(requestOf(spy).url).toBe(playUrl);
  });

  it('goes idle → checking → error', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    await renderProvider(ios({ bundleId: uniqueId(), onError }), probe);
    await act(async () => {
      calls[0].respond({ status: 500 });
    });
    await waitForStatus('error');
    expect(probe.statuses()).toEqual(['idle', 'checking', 'error']);
    expect(probe.current).toMatchObject({
      ...NO_VERDICT,
      local: '1.282.0',
      storeUrl: null,
    });
    expect(probe.current.error).toBeInstanceOf(StoreVersionError);
    expect(probe.current.error?.code).toBe('NETWORK');
  });

  it('applies the 10 second timeout by default', async () => {
    // React（act / test-renderer）は queueMicrotask で更新を流すので、それは本物のままにする
    // （偽にすると React の microtask が流れずに残り、setup の「偽のタイマーの残り」で落ちる）
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    setPlatform('android');
    const onError = createOnError();
    await renderProvider(
      android({ getLatestVersion: never(), onError }),
      probe
    );
    expect(probe.current.status).toBe('checking');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    });
    expect(probe.current.status).toBe('checking');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(probe.current.status).toBe('error');
    expect(codesOf(onError)).toEqual(['TIMEOUT']);
  });
});

// 失敗の種類ごとの status / result（action）/ onError（UI はデフォルト UI のテストで確かめる）
describe('StoreVersionProvider: status / result / onError for each failure', () => {
  describe('skipped (onError is not called)', () => {
    afterEach(() => {
      setOptionalModules();
    });

    it.each([
      ['web', 'web' as const],
      ['an OS other than ios / android', 'windows' as const],
    ])('%s', async (_, os) => {
      setPlatform(os);
      const onError = createOnError();
      const onResult = createOnResult();
      const spy = jest.spyOn(globalThis, 'fetch');
      await renderProvider(ios({ onError, onResult }), probe);
      expect(probe.current).toMatchObject({
        status: 'skipped',
        ...NO_VERDICT,
        local: null,
        error: null,
      });
      expect(onError).not.toHaveBeenCalled();
      expect(onResult).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ['ios', 'host.exp.Exponent'],
      ['android', 'host.exp.exponent'],
    ] as const)(
      'Expo Go (%s, even with explicit values)',
      async (os, applicationId) => {
        setPlatform(os);
        setOptionalModules({
          'expo-application': {
            applicationId,
            nativeApplicationVersion: '2.0.0',
          },
        });
        const onError = createOnError();
        const spy = jest.spyOn(globalThis, 'fetch');
        await renderProvider(
          { ...ios(), packageName: 'com.example', onError },
          probe
        );
        expect(probe.current).toMatchObject({
          status: 'skipped',
          ...NO_VERDICT,
        });
        expect(onError).not.toHaveBeenCalled();
        expect(spy).not.toHaveBeenCalled();
      }
    );

    it('enabled={false}', async () => {
      const onError = createOnError();
      const spy = jest.spyOn(globalThis, 'fetch');
      await renderProvider(ios({ enabled: false, onError }), probe);
      expect(probe.current).toMatchObject({ status: 'skipped', ...NO_VERDICT });
      expect(onError).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('LOCAL_VERSION_UNAVAILABLE: error and onError', async () => {
    setOptionalModules();
    const onError = createOnError();
    const onResult = createOnResult();
    await renderProvider({ bundleId: 'com.x', onError, onResult }, probe);
    expect(probe.current).toMatchObject({
      status: 'error',
      ...NO_VERDICT,
      local: null,
    });
    expect(probe.current.error?.code).toBe('LOCAL_VERSION_UNAVAILABLE');
    expect(onError.mock.calls).toEqual([[probe.current.error]]);
    expect(onResult).not.toHaveBeenCalled();
  });

  it.each([
    [
      'TIMEOUT (store)',
      () => {
        mockFetchPending();
        return ios({ bundleId: uniqueId(), timeoutMs: 20 });
      },
      'TIMEOUT',
    ],
    [
      'TIMEOUT (getLatestVersion)',
      () => {
        setPlatform('android');
        return android({ getLatestVersion: never(), timeoutMs: 20 });
      },
      'TIMEOUT',
    ],
    [
      'NETWORK (HTTP error)',
      () => {
        mockFetchResponse('', 503);
        return ios();
      },
      'NETWORK',
    ],
    [
      'NETWORK (network error)',
      () => {
        mockFetchReject(new TypeError('Network request failed'));
        return ios();
      },
      'NETWORK',
    ],
    [
      'NETWORK (iTunes Lookup is not JSON)',
      () => {
        mockFetchResponse('<html>');
        return ios();
      },
      'NETWORK',
    ],
    [
      'NOT_FOUND',
      () => {
        mockFetchFixture('store/itunes-lookup-empty.json');
        return ios();
      },
      'NOT_FOUND',
    ],
    [
      'PARSE_FAILED',
      () => {
        setPlatform('android');
        mockFetchFixture('store/playstore-changed.html');
        return android();
      },
      'PARSE_FAILED',
    ],
    [
      'INVALID_VERSION (Play)',
      () => {
        setPlatform('android');
        mockFetchFixture('store/playstore-varies.html');
        return android();
      },
      'INVALID_VERSION',
    ],
    [
      'INVALID_VERSION (getLatestVersion)',
      () => {
        setPlatform('android');
        return android({ getLatestVersion: getter('Varies with device') });
      },
      'INVALID_VERSION',
    ],
    [
      'POLICY_FAILED (the policy function throws)',
      () => {
        setPlatform('android');
        mockFetchFixture('store/playstore.html');
        return android({
          policy: () => {
            throw new Error('bug');
          },
        });
      },
      'POLICY_FAILED',
    ],
    [
      'POLICY_FAILED (an invalid value)',
      () => {
        setPlatform('android');
        return android({ policy: 'forse' as 'force' });
      },
      'POLICY_FAILED',
    ],
    [
      'LATEST_VERSION_FAILED (throws)',
      () => {
        setPlatform('android');
        return android({ getLatestVersion: failing() });
      },
      'LATEST_VERSION_FAILED',
    ],
    [
      'LATEST_VERSION_FAILED (an empty string)',
      () => {
        setPlatform('android');
        return android({ getLatestVersion: getter('') });
      },
      'LATEST_VERSION_FAILED',
    ],
  ])('%s: error, result / action null, onError', async (_, setup, code) => {
    const onError = createOnError();
    const onResult = createOnResult();
    await renderProvider({ ...setup(), onError, onResult }, probe);
    await waitForStatus('error');
    expect(verdictOf(probe)).toEqual({ status: 'error', ...NO_VERDICT });
    expect(probe.current.error?.code).toBe(code);
    expect(onError.mock.calls).toEqual([[probe.current.error]]);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('INVALID_VERSION with a valid minimum above local: ready, force, result / detail / diff null, onError', async () => {
    setPlatform('android');
    mockFetchFixture('store/playstore-varies.html');
    const onError = createOnError();
    const onResult = createOnResult();
    await renderProvider(
      android({ getMinimumVersion: getter('2.0.0'), onError, onResult }),
      probe
    );
    await waitForStatus('ready');
    expect(verdictOf(probe)).toEqual({
      status: 'ready',
      result: null,
      detail: null,
      action: 'force',
      diff: null,
      remote: null,
    });
    expect(probe.current.error).toBeNull();
    expect(codesOf(onError)).toEqual(['INVALID_VERSION']);
    expect(onResult.mock.calls).toEqual([
      [
        {
          result: null,
          detail: null,
          action: 'force',
          diff: null,
          local: '1.282.0',
          remote: null,
        },
      ],
    ]);
  });

  it.each([
    ['throws', () => failing()],
    ['returns an invalid value', () => getter(42 as unknown as string)],
    ['returns an incomparable version', () => getter('abc')],
  ])(
    'MINIMUM_VERSION_FAILED (getMinimumVersion %s): ready with the store comparison, onError',
    async (_, make) => {
      setPlatform('android');
      mockFetchFixture('store/playstore.html');
      const onError = createOnError();
      const onResult = createOnResult();
      await renderProvider(
        android({ getMinimumVersion: make(), onError, onResult }),
        probe
      );
      await waitForStatus('ready');
      expect(verdictOf(probe)).toEqual({
        status: 'ready',
        result: 'new',
        detail: 'remote > local',
        action: 'warning',
        diff: 'minor',
        remote: '1.283.0',
      });
      expect(codesOf(onError)).toEqual(['MINIMUM_VERSION_FAILED']);
      expect(onResult).toHaveBeenCalledTimes(1);
    }
  );

  it('MINIMUM_VERSION_FAILED (getMinimumVersion times out, cause TIMEOUT): ready', async () => {
    setPlatform('android');
    const onError = createOnError();
    await renderProvider(
      android({
        getLatestVersion: getter('2.0.0'),
        getMinimumVersion: never(),
        timeoutMs: 20,
        onError,
      }),
      probe
    );
    await waitForStatus('ready');
    expect(verdictOf(probe)).toMatchObject({
      result: 'new',
      action: 'force',
      diff: 'major',
    });
    expect(codesOf(onError)).toEqual(['MINIMUM_VERSION_FAILED']);
    expect(onError.mock.calls[0][0].cause).toMatchObject({ code: 'TIMEOUT' });
  });

  it('passes the errors attached to the rejection too (INVALID_VERSION + MINIMUM_VERSION_FAILED)', async () => {
    setPlatform('android');
    const onError = createOnError();
    await renderProvider(
      android({
        getLatestVersion: getter('Varies with device'),
        getMinimumVersion: getter('abc'),
        onError,
      }),
      probe
    );
    await waitForStatus('error');
    expect(probe.current.error?.code).toBe('INVALID_VERSION');
    expect(codesOf(onError)).toEqual([
      'INVALID_VERSION',
      'MINIMUM_VERSION_FAILED',
    ]);
    expect(onError.mock.calls[0][0]).toBe(probe.current.error);
  });

  it('passes the errors attached to a TIMEOUT (getMinimumVersion already failed)', async () => {
    setPlatform('android');
    const onError = createOnError();
    await renderProvider(
      android({
        getLatestVersion: never(),
        getMinimumVersion: failing(),
        timeoutMs: 20,
        onError,
      }),
      probe
    );
    await waitForStatus('error');
    expect(codesOf(onError)).toEqual(['TIMEOUT', 'MINIMUM_VERSION_FAILED']);
  });

  describe('STORE_URL_UNAVAILABLE at launch: status / result unchanged, onError', () => {
    it('iOS with getLatestVersion: the URL lookup fails', async () => {
      mockFetchFixture('store/itunes-lookup-empty.json');
      const onError = createOnError();
      const onResult = createOnResult();
      await renderProvider(
        ios({ getLatestVersion: getter('2.0.0'), onError, onResult }),
        probe
      );
      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(verdictOf(probe)).toEqual({
        status: 'ready',
        result: 'new',
        detail: 'remote > local',
        action: 'force',
        diff: 'major',
        remote: '2.0.0',
      });
      expect(probe.current.storeUrl).toBeNull();
      expect(probe.current.error).toBeNull();
      expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE']);
      expect(onError.mock.calls[0][0].cause).toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(onResult).toHaveBeenCalledTimes(1);
    });

    it('iOS store: the lookup has no trackViewUrl', async () => {
      mockFetchResponse(JSON.stringify({ results: [{ version: '1.283.0' }] }));
      const onError = createOnError();
      await renderProvider(ios({ onError }), probe);
      await waitFor(() => expect(onError).toHaveBeenCalled());
      expect(verdictOf(probe)).toMatchObject({
        status: 'ready',
        action: 'warning',
      });
      expect(probe.current.storeUrl).toBeNull();
      expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE']);
    });
  });
});

describe('StoreVersionProvider: storeUrl', () => {
  it('iOS with getLatestVersion: null until the URL lookup finishes, then updated', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    await renderProvider(
      ios({
        bundleId: uniqueId(),
        getLatestVersion: getter('2.0.0'),
        onError,
      }),
      probe
    );
    await waitForStatus('ready');
    expect(probe.current).toMatchObject({
      action: 'force',
      remote: '2.0.0',
      storeUrl: null,
      // getLatestVersion を使うときは lookup の releaseNotes を使わない
      releaseNotes: undefined,
    });
    await act(async () => {
      calls[0].respond({ body: lookupBody('9.9.9') });
    });
    await waitFor(() => expect(probe.current.storeUrl).toBe(trackViewUrl));
    // lookup の version は判定に使わない
    expect(probe.current.remote).toBe('2.0.0');
    expect(probe.current.releaseNotes).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('StoreVersionProvider: onResult', () => {
  it('is called once per ready with { result, detail, action, diff, local, remote }', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    const onResult = createOnResult();
    await renderProvider(ios({ onResult, onError: createOnError() }), probe);
    await waitForStatus('ready');
    expect(onResult.mock.calls).toEqual([
      [
        {
          result: 'new',
          detail: 'remote > local',
          action: 'warning',
          diff: 'minor',
          local: '1.282.0',
          remote: '1.283.0',
        },
      ],
    ]);

    await act(async () => {
      probe.current.recheck();
    });
    await waitForStatus('ready');
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
  });

  it('reports equal / old as action none', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    const onResult = createOnResult();
    await renderProvider(
      ios({ version: '1.284.0', onResult, onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    expect(onResult.mock.calls[0][0]).toEqual({
      result: 'old',
      detail: 'remote < local',
      action: 'none',
      diff: null,
      local: '1.284.0',
      remote: '1.283.0',
    });
  });
});

describe('StoreVersionProvider: onError is missing', () => {
  it('warns in __DEV__', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchFixture('store/itunes-lookup-empty.json');
    await renderProvider(ios(), probe);
    await waitForStatus('error');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      '[react-native-store-version] NOT_FOUND: the app (bundleId "com.github.stormbreaker.prod") is not found on the App Store (jp)'
    );
    expect(warn.mock.calls[0][1]).toBe(probe.current.error);
  });

  it('stays silent outside __DEV__', async () => {
    const holder = globalThis as { __DEV__?: boolean };
    const original = holder.__DEV__;
    holder.__DEV__ = false;
    try {
      const warn = jest.spyOn(console, 'warn');
      mockFetchFixture('store/itunes-lookup-empty.json');
      await renderProvider(ios(), probe);
      await waitForStatus('error');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      holder.__DEV__ = original;
    }
  });
});

describe('StoreVersionProvider: callbacks that throw', () => {
  it('does not turn into an unhandled rejection, and warns in __DEV__', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setPlatform('android');
    mockFetchFixture('store/playstore.html');
    const thrown = new Error('callback bug');
    await renderProvider(
      android({
        getMinimumVersion: failing(),
        onResult: () => {
          throw thrown;
        },
        onError: () => {
          throw thrown;
        },
      }),
      probe
    );
    await waitForStatus('ready');
    await nextTask();
    expect(warn.mock.calls).toEqual([
      ['[react-native-store-version] onError threw', thrown],
      ['[react-native-store-version] onResult threw', thrown],
    ]);
  });
});

describe('StoreVersionProvider: callbacks that return a rejected Promise', () => {
  it('does not wait for them nor turn them into unhandled rejections, and warns in __DEV__', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setPlatform('android');
    mockFetchFixture('store/playstore.html');
    const rejected = new Error('async callback bug');
    await renderProvider(
      android({
        getMinimumVersion: failing(),
        onResult: async () => {
          throw rejected;
        },
        onError: async () => {
          throw rejected;
        },
      }),
      probe
    );
    await waitForStatus('ready');
    // unhandled rejection は次のタスクで検出される（setup の waitForUnhandledRejections）ので、そこまで待つ
    await nextTask();
    await nextTask();
    expect(warn.mock.calls).toEqual([
      ['[react-native-store-version] onError threw', rejected],
      ['[react-native-store-version] onResult threw', rejected],
    ]);
  });

  it('stays silent outside __DEV__', async () => {
    const holder = globalThis as { __DEV__?: boolean };
    const original = holder.__DEV__;
    holder.__DEV__ = false;
    try {
      const warn = jest.spyOn(console, 'warn');
      mockFetchFixture('store/itunes-lookup-empty.json');
      await renderProvider(
        ios({
          onError: () => Promise.reject(new Error('async callback bug')),
        }),
        probe
      );
      await waitForStatus('error');
      await nextTask();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      holder.__DEV__ = original;
    }
  });
});

describe('StoreVersionProvider: what triggers a check', () => {
  it('does not check again when props change (inline getters, version, country, timeoutMs, ...)', async () => {
    setPlatform('android');
    const first = getter('2.0.0');
    const onError = createOnError();
    const view = await renderProvider(
      android({ getLatestVersion: first, onError }),
      probe
    );
    await waitForStatus('ready');
    const second = getter('3.0.0');
    await view.rerender(
      android({
        version: '0.1.0',
        packageName: 'com.other',
        country: 'us',
        timeoutMs: 1,
        getLatestVersion: second,
        getMinimumVersion: getter('9.0.0'),
        recheckOnForeground: true,
        onError,
      })
    );
    await nextTask();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(probe.current).toMatchObject({
      status: 'ready',
      local: '1.282.0',
      remote: '2.0.0',
    });
  });

  it('recheck() reads the latest props', async () => {
    setPlatform('android');
    const first = getter('2.0.0');
    const onError = createOnError();
    const view = await renderProvider(
      android({ getLatestVersion: first, onError }),
      probe
    );
    await waitForStatus('ready');
    const second = getter('1.282.1');
    await view.rerender(android({ getLatestVersion: second, onError }));
    await act(async () => {
      probe.current.recheck();
    });
    await waitFor(() => expect(probe.current.remote).toBe('1.282.1'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(probe.current).toMatchObject({ action: 'warning', diff: 'patch' });
  });

  it('recheck() goes checking → ready and fetches again', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    const { calls } = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    // 再チェックの間は前回の ready の値を見せ続ける
    expect(probe.current).toMatchObject({
      status: 'checking',
      result: 'new',
      action: 'warning',
      remote: '1.283.0',
      storeUrl: trackViewUrl,
      releaseNotes: "What's new\n\n…",
      error: null,
    });
    expect(probe.current.local).toBe('1.282.0');
    await act(async () => {
      calls[0].respond({ body: lookupBody('1.290.0') });
    });
    await waitFor(() => expect(probe.current.remote).toBe('1.290.0'));
    expect(probe.statuses()).toEqual([
      'idle',
      'checking',
      'ready',
      'checking',
      'ready',
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('recheck() while checking cancels the running check without onError', async () => {
    setPlatform('android');
    const onError = createOnError();
    const onResult = createOnResult();
    const slow = never();
    const view = await renderProvider(
      android({ getLatestVersion: slow, onError, onResult }),
      probe
    );
    expect(probe.current.status).toBe('checking');
    const signal = slow.mock.calls[0][0].signal;
    await view.rerender(
      android({ getLatestVersion: getter('2.0.0'), onError, onResult })
    );
    await act(async () => {
      probe.current.recheck();
    });
    await waitForStatus('ready');
    expect(signal.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('fetches once with a pending check under StrictMode (getters may be called twice)', async () => {
    const { calls } = mockFetchPending();
    const onResult = createOnResult();
    const minimum = getter(null);
    await render(
      <StrictMode>
        <StoreVersionProvider
          {...ios({
            bundleId: uniqueId(),
            recheckOnForeground: true,
            getMinimumVersion: minimum,
            onResult,
            onError: createOnError(),
          })}
        >
          {probe.element}
        </StoreVersionProvider>
      </StrictMode>
    );
    await nextTask();
    expect(calls).toHaveLength(1);
    // StrictMode のマウント・アンマウント・マウントの後も、AppState の購読は 1 つだけ
    expect(appState.listenerCount).toBe(1);
    // getter は StrictMode の 2 回の effect でそれぞれ呼ばれる
    expect(minimum).toHaveBeenCalledTimes(2);
    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitForStatus('ready');
    expect(onResult).toHaveBeenCalledTimes(1);

    // StrictMode の中でも、background → active の取り直しは 1 回だけ
    await act(async () => {
      appState.change('background');
    });
    await act(async () => {
      appState.change('active');
    });
    expect(minimum).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
  });

  it('reports LOCAL_VERSION_UNAVAILABLE once under StrictMode', async () => {
    setOptionalModules();
    const onError = createOnError();
    await render(
      <StrictMode>
        <StoreVersionProvider bundleId="com.x" onError={onError}>
          {probe.element}
        </StoreVersionProvider>
      </StrictMode>
    );
    await nextTask();
    expect(probe.current.status).toBe('error');
    expect(codesOf(onError)).toEqual(['LOCAL_VERSION_UNAVAILABLE']);
  });
});

describe('StoreVersionProvider: AppState', () => {
  it('recheckOnForeground: checks again on background → active', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const onResult = createOnResult();
    await renderProvider(
      ios({ recheckOnForeground: true, onResult, onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    await act(async () => {
      appState.change('background');
    });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      appState.change('active');
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('recheckOnForeground: does not check on inactive → active (notification center, permission dialogs)', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(
      ios({ recheckOnForeground: true, onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    await act(async () => {
      appState.change('inactive');
    });
    await act(async () => {
      appState.change('active');
    });
    await nextTask();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(probe.current.status).toBe('ready');
  });

  it('recheckOnForeground: background → inactive → active is still a return from the background', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(
      ios({ recheckOnForeground: true, onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    await act(async () => {
      appState.change('background');
      appState.change('inactive');
      appState.change('active');
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('without recheckOnForeground: does not check on background → active', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    await act(async () => {
      appState.change('background');
    });
    await act(async () => {
      appState.change('active');
    });
    await nextTask();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([[false], [true]])(
    'background while checking: aborts without onError and checks again once on active (recheckOnForeground %s)',
    async (recheckOnForeground) => {
      const { calls } = mockFetchPending();
      const onError = createOnError();
      const onResult = createOnResult();
      // 取り直しの回数を getter の呼び出しで数える（ストアへの fetch は request.ts の共有で 1 つにまとまりうるので）
      const minimum = getter(null);
      await renderProvider(
        ios({
          bundleId: uniqueId(),
          recheckOnForeground,
          getMinimumVersion: minimum,
          onError,
          onResult,
        }),
        probe
      );
      expect(calls).toHaveLength(1);
      expect(minimum).toHaveBeenCalledTimes(1);
      await act(async () => {
        appState.change('background');
      });
      await nextTask();
      expect(calls[0].aborted).toBe(true);
      // 取り消した判定は error にしない（復帰時に取り直す）
      expect(probe.current.status).toBe('checking');
      expect(onError).not.toHaveBeenCalled();

      await act(async () => {
        appState.change('active');
      });
      expect(calls).toHaveLength(2);
      await act(async () => {
        calls[1].respond({ body: readFixture('store/itunes-lookup.json') });
      });
      await waitForStatus('ready');
      await nextTask();
      expect(calls).toHaveLength(2);
      expect(minimum).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalled();
      expect(onResult).toHaveBeenCalledTimes(1);
    }
  );

  it.each([[false], [true]])(
    'background while checking with getters: aborts the getter signal and calls the getters again once on active (recheckOnForeground %s)',
    async (recheckOnForeground) => {
      setPlatform('android');
      const onError = createOnError();
      const latest = jest.fn<
        ReturnType<VersionGetter>,
        Parameters<VersionGetter>
      >(() => new Promise(() => {}));
      await renderProvider(
        android({ getLatestVersion: latest, recheckOnForeground, onError }),
        probe
      );
      await act(async () => {
        appState.change('background');
      });
      expect(latest.mock.calls[0][0].signal.aborted).toBe(true);
      latest.mockImplementation(async () => '2.0.0');
      await act(async () => {
        appState.change('active');
      });
      await waitForStatus('ready');
      expect(latest).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalled();
    }
  );

  it.each([[false], [true]])(
    'mounted in the background: stays idle until the first active, then checks once (recheckOnForeground %s)',
    async (recheckOnForeground) => {
      appState = mockAppState('background');
      const spy = mockFetchFixture('store/itunes-lookup.json');
      const onError = createOnError();
      await renderProvider(ios({ recheckOnForeground, onError }), probe);
      await nextTask();
      expect(probe.current.status).toBe('idle');
      expect(spy).not.toHaveBeenCalled();
      // inactive の間もまだ始めない
      await act(async () => {
        appState.change('inactive');
      });
      expect(probe.current.status).toBe('idle');
      expect(spy).not.toHaveBeenCalled();
      await act(async () => {
        appState.change('active');
      });
      await waitForStatus('ready');
      await nextTask();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(probe.statuses()).toEqual(['idle', 'checking', 'ready']);
      expect(onError).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['enabled={false}', () => ios({ enabled: false })],
    [
      'web',
      () => {
        setPlatform('web');
        return ios();
      },
    ],
    [
      'an OS other than ios / android',
      () => {
        setPlatform('windows');
        return ios();
      },
    ],
    [
      'Expo Go',
      () => {
        setOptionalModules({
          'expo-application': {
            applicationId: 'host.exp.Exponent',
            nativeApplicationVersion: '2.0.0',
          },
        });
        return ios();
      },
    ],
  ])(
    'mounted in the background with %s: skipped right away (does not wait for active)',
    async (_, setup) => {
      try {
        // setOptionalModules は jest.resetModules するので（react-native の AppState も読み直される）、AppState はその後に差し替える
        const props = setup();
        appState = mockAppState('background');
        const onError = createOnError();
        const spy = jest.spyOn(globalThis, 'fetch');
        await renderProvider({ ...props, onError }, probe);
        expect(probe.current).toMatchObject({
          status: 'skipped',
          ...NO_VERDICT,
        });
        expect(onError).not.toHaveBeenCalled();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        setOptionalModules();
      }
    }
  );

  it('mounted in the background without the app version: LOCAL_VERSION_UNAVAILABLE right away', async () => {
    // setOptionalModules は jest.resetModules するので（react-native の AppState も読み直される）、AppState はその後に差し替える
    setOptionalModules();
    appState = mockAppState('background');
    const onError = createOnError();
    await renderProvider({ bundleId: 'com.x', onError }, probe);
    await nextTask();
    expect(probe.current.status).toBe('error');
    expect(codesOf(onError)).toEqual(['LOCAL_VERSION_UNAVAILABLE']);
  });

  it('mounted while inactive: checks right away', async () => {
    appState = mockAppState('inactive');
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('recheck() in the background waits for active', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    await act(async () => {
      appState.change('background');
    });
    await act(async () => {
      probe.current.recheck();
    });
    await nextTask();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(probe.current.status).toBe('ready');
    await act(async () => {
      appState.change('active');
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await waitForStatus('ready');
  });

  it('background while rechecking: keeps the previous result while aborted, and checks again on active', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    await renderProvider(ios({ policy: 'force', onError }), probe);
    await waitForStatus('ready');
    const { calls } = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    await act(async () => {
      appState.change('background');
    });
    await nextTask();
    expect(calls[0].aborted).toBe(true);
    expect(probe.current).toMatchObject({
      status: 'checking',
      action: 'force',
      remote: '1.283.0',
    });
    await act(async () => {
      appState.change('active');
    });
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1].respond({ body: lookupBody('1.290.0') });
    });
    await waitFor(() => expect(probe.current.remote).toBe('1.290.0'));
    expect(onError).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('background after ready stops only the pending iOS URL lookup: no onError, no recheck, openStore looks up again', async () => {
    const openURL = mockOpenURL();
    const { calls } = mockFetchPending();
    const onError = createOnError();
    const latest = getter('2.0.0');
    await renderProvider(
      ios({ bundleId: uniqueId(), getLatestVersion: latest, onError }),
      probe
    );
    await waitForStatus('ready');
    expect(calls).toHaveLength(1);
    await act(async () => {
      appState.change('background');
    });
    await nextTask();
    expect(calls[0].aborted).toBe(true);
    await act(async () => {
      appState.change('active');
    });
    await nextTask();
    // 判定は終わっているので取り直さない。lookup の中断は onError に渡さない
    expect(latest).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
    expect(probe.current).toMatchObject({
      status: 'ready',
      action: 'force',
      storeUrl: null,
    });
    // ストアを開くときにその場で lookup し直す
    const opening = probe.current.openStore();
    await nextTask();
    expect(calls).toHaveLength(2);
    await act(async () => {
      calls[1].respond({ body: lookupBody('2.0.0') });
    });
    await expect(opening).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(onError).not.toHaveBeenCalled();
  });

  it('background after ready does not abort or recheck by itself', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    await act(async () => {
      appState.change('background');
    });
    await act(async () => {
      appState.change('active');
    });
    expect(probe.current.status).toBe('ready');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('StoreVersionProvider: unmount', () => {
  it('aborts the check and calls neither onResult / onError nor setState afterwards', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    const onResult = createOnResult();
    const view = await renderProvider(
      ios({ bundleId: uniqueId(), onError, onResult }),
      probe
    );
    const rendered = probe.history.length;
    expect(appState.listenerCount).toBe(1);
    await view.unmount();
    expect(appState.listenerCount).toBe(0);
    await nextTask();
    expect(calls[0].aborted).toBe(true);
    await nextTask();
    expect(onError).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
    expect(probe.history).toHaveLength(rendered);
  });

  it('ignores recheck() / dismiss() called after unmount', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const onResult = createOnResult();
    const view = await renderProvider(
      ios({ onResult, onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    const { recheck, dismiss } = probe.current;
    const rendered = probe.history.length;
    await view.unmount();
    recheck();
    dismiss();
    await nextTask();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(probe.history).toHaveLength(rendered);
  });

  it('does not call onError when the getter fails after unmount', async () => {
    setPlatform('android');
    let fail: (error: unknown) => void = () => {};
    const latest = jest.fn<
      ReturnType<VersionGetter>,
      Parameters<VersionGetter>
    >(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    const onError = createOnError();
    const view = await renderProvider(
      android({
        getLatestVersion: latest,
        getMinimumVersion: failing(),
        onError,
      }),
      probe
    );
    await view.unmount();
    fail(new Error('late'));
    await nextTask();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not update storeUrl or call onError when the URL lookup ends after unmount', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    const view = await renderProvider(
      ios({ bundleId: uniqueId(), getLatestVersion: getter('2.0.0'), onError }),
      probe
    );
    await waitForStatus('ready');
    const rendered = probe.history.length;
    await view.unmount();
    await nextTask();
    expect(calls[0].aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(probe.history).toHaveLength(rendered);
  });
});

describe('StoreVersionProvider: rechecking keeps the previous result', () => {
  it('never hides a force while rechecking (recheckOnForeground)', async () => {
    const { calls } = mockFetchPending();
    const onResult = createOnResult();
    await renderProvider(
      ios({
        bundleId: uniqueId(),
        policy: 'force',
        recheckOnForeground: true,
        onResult,
        onError: createOnError(),
      }),
      probe
    );
    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitForStatus('ready');
    const firstReady = probe.history.findIndex((h) => h.status === 'ready');
    await act(async () => {
      appState.change('background');
    });
    await act(async () => {
      appState.change('active');
    });
    expect(calls).toHaveLength(2);
    expect(probe.current.status).toBe('checking');
    await act(async () => {
      calls[1].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitForStatus('ready');
    // 最初の ready の後の描画では、一度も action が force 以外にならない
    expect(
      probe.history.slice(firstReady).every((h) => h.action === 'force')
    ).toBe(true);
    expect(probe.statuses()).toEqual([
      'idle',
      'checking',
      'ready',
      'checking',
      'ready',
    ]);
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'a network error',
      (calls: ReturnType<typeof mockFetchPending>['calls']) =>
        calls[0].respond({ status: 503 }),
      'NETWORK',
    ],
    [
      'NOT_FOUND',
      (calls: ReturnType<typeof mockFetchPending>['calls']) =>
        calls[0].respond({
          body: readFixture('store/itunes-lookup-empty.json'),
        }),
      'NOT_FOUND',
    ],
  ])(
    'falls back to the previous ready when the recheck fails (%s): error stays null, onError, no onResult',
    async (_, fail, code) => {
      mockFetchFixture('store/itunes-lookup.json');
      const onResult = createOnResult();
      const onError = createOnError();
      await renderProvider(ios({ onResult, onError }), probe);
      await waitForStatus('ready');
      const { calls } = mockFetchPending();
      await act(async () => {
        probe.current.recheck();
      });
      await act(async () => {
        fail(calls);
      });
      await waitForStatus('ready');
      expect(probe.current).toMatchObject({
        status: 'ready',
        result: 'new',
        detail: 'remote > local',
        action: 'warning',
        diff: 'minor',
        local: '1.282.0',
        remote: '1.283.0',
        storeUrl: trackViewUrl,
        releaseNotes: "What's new\n\n…",
        error: null,
      });
      expect(codesOf(onError)).toEqual([code]);
      expect(onResult).toHaveBeenCalledTimes(1);
      expect(probe.statuses()).toEqual([
        'idle',
        'checking',
        'ready',
        'checking',
        'ready',
      ]);
    }
  );

  it('falls back to the previous ready when the app can no longer be detected on recheck (LOCAL_VERSION_UNAVAILABLE)', async () => {
    setOptionalModules();
    try {
      mockFetchFixture('store/itunes-lookup.json');
      const onError = createOnError();
      const view = await renderProvider(ios({ onError }), probe);
      await waitForStatus('ready');
      await view.rerender({
        bundleId: 'com.github.stormbreaker.prod',
        onError,
      });
      await act(async () => {
        probe.current.recheck();
      });
      expect(probe.current).toMatchObject({
        status: 'ready',
        action: 'warning',
        remote: '1.283.0',
        error: null,
      });
      expect(codesOf(onError)).toEqual(['LOCAL_VERSION_UNAVAILABLE']);
    } finally {
      setOptionalModules();
    }
  });

  it('falls back to the previous ready on a recheck timeout, and passes the attached errors', async () => {
    setPlatform('android');
    const onError = createOnError();
    const latest = jest.fn<
      ReturnType<VersionGetter>,
      Parameters<VersionGetter>
    >(async () => '2.0.0');
    const minimum = jest.fn<
      ReturnType<VersionGetter>,
      Parameters<VersionGetter>
    >(async () => null);
    await renderProvider(
      android({
        getLatestVersion: latest,
        getMinimumVersion: minimum,
        timeoutMs: 20,
        onError,
      }),
      probe
    );
    await waitForStatus('ready');
    latest.mockImplementation(() => new Promise(() => {}));
    minimum.mockImplementation(async () => {
      throw new Error('remote config');
    });
    await act(async () => {
      probe.current.recheck();
    });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(codesOf(onError)).toEqual(['TIMEOUT', 'MINIMUM_VERSION_FAILED']);
    expect(probe.current).toMatchObject({
      status: 'ready',
      action: 'force',
      remote: '2.0.0',
      error: null,
    });
  });

  it('keeps a dismissed warning dismissed while rechecking, and lets dismiss() work during the recheck', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    await act(async () => {
      probe.current.dismiss();
    });
    let pending = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    expect(probe.current).toMatchObject({
      status: 'checking',
      action: 'warning',
      dismissed: true,
    });
    await act(async () => {
      pending.calls[0].respond({ body: lookupBody('1.290.0') });
    });
    await waitFor(() => expect(probe.current.remote).toBe('1.290.0'));
    // remote が変わったので解除
    expect(probe.current.dismissed).toBe(false);

    pending = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    // 再チェック中に「あとで」が押されたら、前回の remote を閉じる
    await act(async () => {
      probe.current.dismiss();
    });
    expect(probe.current).toMatchObject({
      status: 'checking',
      dismissed: true,
    });
    await act(async () => {
      pending.calls[0].respond({ body: lookupBody('1.290.0') });
    });
    await waitForStatus('ready');
    expect(probe.current.dismissed).toBe(true);
  });

  it('applies a policy changed while rechecking: on success to the new result, on failure to the previous one', async () => {
    setPlatform('android');
    const spy = mockFetchFixture('store/playstore.html');
    const onResult = createOnResult();
    const onError = createOnError();
    const view = await renderProvider(android({ onResult, onError }), probe);
    await waitForStatus('ready');
    expect(probe.current.action).toBe('warning');

    // 失敗する再チェックの間に policy を変える → 前回の取得結果に当て直す
    let pending = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    await view.rerender(android({ policy: 'force', onResult, onError }));
    // 再チェック中は前回の action のまま
    expect(probe.current).toMatchObject({
      status: 'checking',
      action: 'warning',
    });
    await act(async () => {
      pending.calls[0].respond({ status: 500 });
    });
    await waitFor(() => expect(probe.current.action).toBe('force'));
    expect(probe.current.status).toBe('ready');
    expect(onResult.mock.calls.map(([r]) => r.action)).toEqual([
      'warning',
      'force',
    ]);

    // 成功する再チェックの間に policy を変える → 新しい結果に当てて onResult は 1 回
    pending = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    await view.rerender(android({ policy: 'none', onResult, onError }));
    expect(probe.current.action).toBe('force');
    await act(async () => {
      pending.calls[0].respond({ body: readFixture('store/playstore.html') });
    });
    await waitFor(() => expect(probe.current.action).toBe('none'));
    expect(onResult.mock.calls.map(([r]) => r.action)).toEqual([
      'warning',
      'force',
      'none',
    ]);
    expect(codesOf(onError)).toEqual(['NETWORK']);
    // 取得は初回と 2 回の再チェックだけ（policy の変更では取り直さない。mockFetchPending も同じ spy を使う）
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('keeps the previous URL lookup running during a recheck and reflects it in the result shown', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    const latest = jest
      .fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>()
      .mockImplementationOnce(async () => '2.0.0')
      .mockImplementation(() => new Promise(() => {}));
    await renderProvider(
      ios({ bundleId: uniqueId(), getLatestVersion: latest, onError }),
      probe
    );
    await waitForStatus('ready');
    expect(probe.current.storeUrl).toBeNull();
    await act(async () => {
      probe.current.recheck();
    });
    await nextTask();
    expect(probe.current.status).toBe('checking');
    expect(calls[0].aborted).toBe(false);
    await act(async () => {
      calls[0].respond({ body: lookupBody('2.0.0') });
    });
    await waitFor(() => expect(probe.current.storeUrl).toBe(trackViewUrl));
    expect(probe.current).toMatchObject({
      status: 'checking',
      action: 'force',
      remote: '2.0.0',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('reflects the previous URL lookup after a failed recheck too', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    const latest = jest
      .fn<ReturnType<VersionGetter>, Parameters<VersionGetter>>()
      .mockImplementationOnce(async () => '2.0.0')
      .mockImplementation(async () => {
        throw new Error('remote config');
      });
    await renderProvider(
      ios({ bundleId: uniqueId(), getLatestVersion: latest, onError }),
      probe
    );
    await waitForStatus('ready');
    await act(async () => {
      probe.current.recheck();
    });
    await waitFor(() =>
      expect(codesOf(onError)).toEqual(['LATEST_VERSION_FAILED'])
    );
    expect(probe.current.status).toBe('ready');
    await act(async () => {
      calls[0].respond({ body: lookupBody('2.0.0') });
    });
    await waitFor(() => expect(probe.current.storeUrl).toBe(trackViewUrl));
  });

  it('uses the new result once the recheck finishes, and stops the previous URL lookup', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    const bundleId = uniqueId();
    const view = await renderProvider(
      ios({ bundleId, getLatestVersion: getter('2.0.0'), onError }),
      probe
    );
    await waitForStatus('ready');
    expect(calls[0].url).toContain('&country=jp&');
    // 再チェックは最新の props を読む（country が変わると lookup の取得先も変わる）
    await view.rerender(
      ios({
        bundleId,
        country: 'us',
        getLatestVersion: getter('2.1.0'),
        onError,
      })
    );
    await act(async () => {
      probe.current.recheck();
    });
    await waitFor(() => expect(probe.current.remote).toBe('2.1.0'));
    await nextTask();
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('&country=us&');
    expect(calls[0].aborted).toBe(true);
    expect(calls[1].aborted).toBe(false);
    await act(async () => {
      calls[1].respond({ body: lookupBody('2.1.0') });
    });
    await waitFor(() => expect(probe.current.storeUrl).toBe(trackViewUrl));
    expect(onError).not.toHaveBeenCalled();
  });

  it('opens the store with the previous URL while rechecking', async () => {
    const openURL = mockOpenURL();
    mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(
      ios({ bundleId: uniqueId(), onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    const { calls } = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    await expect(probe.current.openStore()).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(calls).toHaveLength(1);
  });

  it('starts from nothing when there is no previous ready (the first check, or after an error)', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    const onError = createOnError();
    await renderProvider(ios({ onError }), probe);
    await waitForStatus('error');
    const { calls } = mockFetchPending();
    await act(async () => {
      probe.current.recheck();
    });
    expect(probe.current).toMatchObject({
      status: 'checking',
      ...NO_VERDICT,
      error: null,
    });
    await act(async () => {
      calls[0].respond({ status: 500 });
    });
    await waitForStatus('error');
    expect(probe.current.error?.code).toBe('NETWORK');
  });
});

describe('StoreVersionProvider: enabled', () => {
  it('false → true starts a check', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    const view = await renderProvider(ios({ enabled: false, onError }), probe);
    expect(probe.current.status).toBe('skipped');
    expect(spy).not.toHaveBeenCalled();
    await view.rerender(ios({ enabled: true, onError }));
    await waitForStatus('ready');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(probe.statuses()).toEqual(['idle', 'skipped', 'checking', 'ready']);
  });

  it('true → false while checking aborts it and turns to skipped without onError', async () => {
    const { calls } = mockFetchPending();
    const onError = createOnError();
    const onResult = createOnResult();
    const bundleId = uniqueId();
    const view = await renderProvider(
      ios({ bundleId, onError, onResult }),
      probe
    );
    await view.rerender(ios({ bundleId, enabled: false, onError, onResult }));
    expect(probe.current).toMatchObject({ status: 'skipped', ...NO_VERDICT });
    await nextTask();
    expect(calls[0].aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('true → false after ready clears the result; openStore() then resolves false', async () => {
    const openURL = mockOpenURL();
    mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    const view = await renderProvider(ios({ onError }), probe);
    await waitForStatus('ready');
    await view.rerender(ios({ enabled: false, onError }));
    expect(probe.current).toMatchObject({
      status: 'skipped',
      ...NO_VERDICT,
      storeUrl: null,
      local: null,
      error: null,
    });
    expect(onError).not.toHaveBeenCalled();
    await expect(probe.current.openStore()).resolves.toBe(false);
    expect(openURL).not.toHaveBeenCalled();
    expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE']);
  });

  it('false → true in the background waits for active', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    const view = await renderProvider(ios({ enabled: false, onError }), probe);
    await act(async () => {
      appState.change('background');
    });
    await view.rerender(ios({ enabled: true, onError }));
    await nextTask();
    expect(spy).not.toHaveBeenCalled();
    expect(probe.current.status).toBe('skipped');
    await act(async () => {
      appState.change('active');
    });
    await waitForStatus('ready');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('true → false in the background cancels the pending start', async () => {
    appState = mockAppState('background');
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    const view = await renderProvider(ios({ onError }), probe);
    await view.rerender(ios({ enabled: false, onError }));
    expect(probe.current.status).toBe('skipped');
    await act(async () => {
      appState.change('active');
    });
    await nextTask();
    expect(spy).not.toHaveBeenCalled();
    expect(probe.current.status).toBe('skipped');
  });
});

describe('StoreVersionProvider: policy', () => {
  it('recomputes action from the last latest / minimum without fetching again', async () => {
    setPlatform('android');
    const spy = mockFetchFixture('store/playstore.html');
    const onResult = createOnResult();
    const onError = createOnError();
    const view = await renderProvider(android({ onResult, onError }), probe);
    await waitForStatus('ready');
    expect(probe.current).toMatchObject({
      result: 'new',
      action: 'warning',
      diff: 'minor',
    });

    await view.rerender(android({ policy: 'force', onResult, onError }));
    await waitFor(() => expect(probe.current.action).toBe('force'));
    // result / detail / diff は policy では変わらない
    expect(probe.current).toMatchObject({
      status: 'ready',
      result: 'new',
      detail: 'remote > local',
      diff: 'minor',
    });
    expect(onResult.mock.calls.map(([r]) => r.action)).toEqual([
      'warning',
      'force',
    ]);

    // 同じ action になる policy（インラインのオブジェクト）では onResult を呼ばない
    await view.rerender(
      android({ policy: { minor: 'force' }, onResult, onError })
    );
    await view.rerender(
      android({ policy: { minor: 'force' }, onResult, onError })
    );
    await nextTask();
    expect(onResult).toHaveBeenCalledTimes(2);

    await view.rerender(android({ policy: () => 'none', onResult, onError }));
    await waitFor(() => expect(probe.current.action).toBe('none'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps the minimum when recomputing (below the minimum stays force)', async () => {
    setPlatform('android');
    mockFetchFixture('store/playstore.html');
    const view = await renderProvider(
      android({
        getMinimumVersion: getter('1.283.0'),
        onError: createOnError(),
      }),
      probe
    );
    await waitForStatus('ready');
    expect(probe.current.action).toBe('force');
    await view.rerender(
      android({
        getMinimumVersion: getter('1.283.0'),
        policy: 'none',
        onError: createOnError(),
      })
    );
    await nextTask();
    expect(probe.current.action).toBe('force');
  });

  it('turns an invalid policy into POLICY_FAILED once, and back to ready with a valid one', async () => {
    setPlatform('android');
    const spy = mockFetchFixture('store/playstore.html');
    const onResult = createOnResult();
    const onError = createOnError();
    const view = await renderProvider(android({ onResult, onError }), probe);
    await waitForStatus('ready');

    const throwing = () => {
      throw new Error('bug');
    };
    await view.rerender(android({ policy: throwing, onResult, onError }));
    await waitForStatus('error');
    expect(probe.current).toMatchObject({ ...NO_VERDICT });
    expect(probe.current.error?.code).toBe('POLICY_FAILED');
    expect(codesOf(onError)).toEqual(['POLICY_FAILED']);
    // 不正な policy が続く間（インラインの関数が描画のたびに変わるなど）は onError を繰り返さない
    await view.rerender(
      android({ policy: 'forse' as 'force', onResult, onError })
    );
    await nextTask();
    expect(onError).toHaveBeenCalledTimes(1);

    await view.rerender(android({ policy: 'force', onResult, onError }));
    await waitForStatus('ready');
    expect(probe.current).toMatchObject({
      action: 'force',
      remote: '1.283.0',
      error: null,
    });
    expect(onResult.mock.calls.map(([r]) => r.action)).toEqual([
      'warning',
      'force',
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('applies the policy changed while checking to the result (onResult once)', async () => {
    const { calls } = mockFetchPending();
    const onResult = createOnResult();
    const onError = createOnError();
    const bundleId = uniqueId();
    const view = await renderProvider(
      ios({ bundleId, onResult, onError }),
      probe
    );
    await view.rerender(ios({ bundleId, policy: 'force', onResult, onError }));
    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitForStatus('ready');
    expect(probe.current.action).toBe('force');
    expect(onResult.mock.calls.map(([r]) => r.action)).toEqual(['force']);
  });

  it('turns the policy changed while checking into POLICY_FAILED when it is invalid', async () => {
    const { calls } = mockFetchPending();
    const onResult = createOnResult();
    const onError = createOnError();
    const bundleId = uniqueId();
    const view = await renderProvider(
      ios({ bundleId, onResult, onError }),
      probe
    );
    await view.rerender(
      ios({ bundleId, policy: 'forse' as 'force', onResult, onError })
    );
    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitForStatus('error');
    expect(codesOf(onError)).toEqual(['POLICY_FAILED']);
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('StoreVersionProvider: dismiss', () => {
  it('dismisses a warning for the same remote, and shows it again for a newer remote', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    expect(probe.current).toMatchObject({
      action: 'warning',
      dismissed: false,
    });

    await act(async () => {
      probe.current.dismiss();
    });
    // 「あとで」は UI を出さないだけで、判定の結果は残る
    expect(probe.current).toMatchObject({
      action: 'warning',
      result: 'new',
      dismissed: true,
    });

    // 同じ remote なら recheck しても出さない
    await act(async () => {
      probe.current.recheck();
    });
    await waitForStatus('ready');
    expect(probe.current).toMatchObject({ remote: '1.283.0', dismissed: true });

    // さらに新しい remote が見つかったら再び出す
    mockFetchResponse(lookupBody('1.284.0'));
    await act(async () => {
      probe.current.recheck();
    });
    await waitFor(() => expect(probe.current.remote).toBe('1.284.0'));
    expect(probe.current).toMatchObject({
      action: 'warning',
      dismissed: false,
    });
  });

  it('does not dismiss a force', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(
      ios({ policy: 'force', onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    await act(async () => {
      probe.current.dismiss();
    });
    expect(probe.current).toMatchObject({ action: 'force', dismissed: false });
  });

  it('shows the warning dismissed earlier again when the policy makes it force', async () => {
    setPlatform('android');
    mockFetchFixture('store/playstore.html');
    const view = await renderProvider(
      android({ onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    await act(async () => {
      probe.current.dismiss();
    });
    expect(probe.current.dismissed).toBe(true);
    await view.rerender(android({ policy: 'force', onError: createOnError() }));
    await waitFor(() => expect(probe.current.action).toBe('force'));
    expect(probe.current.dismissed).toBe(false);
  });

  it('does not record dismiss() during a force (a later warning for the same remote is shown)', async () => {
    setPlatform('android');
    mockFetchFixture('store/playstore.html');
    const view = await renderProvider(
      android({ policy: 'force', onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    await act(async () => {
      probe.current.dismiss();
    });
    await view.rerender(
      android({ policy: 'warning', onError: createOnError() })
    );
    await waitFor(() => expect(probe.current.action).toBe('warning'));
    expect(probe.current.dismissed).toBe(false);
  });

  it('does nothing before ready', async () => {
    const { calls } = mockFetchPending();
    await renderProvider(
      ios({ bundleId: uniqueId(), onError: createOnError() }),
      probe
    );
    await act(async () => {
      probe.current.dismiss();
    });
    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await waitForStatus('ready');
    expect(probe.current.dismissed).toBe(false);
  });
});

describe('StoreVersionProvider: openStore', () => {
  // openStore() は reject せず、開けたかどうかの boolean で resolve する。失敗は onError にだけ渡る
  it('iOS: opens the trackViewUrl from the check', async () => {
    const openURL = mockOpenURL();
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(ios({ onError: createOnError() }), probe);
    await waitForStatus('ready');
    await expect(probe.current.openStore()).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('iOS with getLatestVersion: waits for the URL lookup still in progress', async () => {
    const openURL = mockOpenURL();
    const { calls } = mockFetchPending();
    await renderProvider(
      ios({
        bundleId: uniqueId(),
        getLatestVersion: getter('2.0.0'),
        onError: createOnError(),
      }),
      probe
    );
    await waitForStatus('ready');
    const opening = probe.current.openStore();
    await nextTask();
    expect(openURL).not.toHaveBeenCalled();
    await act(async () => {
      calls[0].respond({ body: lookupBody('2.0.0') });
    });
    await expect(opening).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(calls).toHaveLength(1);
  });

  it('iOS: the lookup at launch and the one on press both fail → STORE_URL_UNAVAILABLE to onError, resolves false, status / error unchanged', async () => {
    const openURL = mockOpenURL();
    mockFetchFixture('store/itunes-lookup-empty.json');
    const onError = createOnError();
    await renderProvider(
      ios({ getLatestVersion: getter('2.0.0'), onError }),
      probe
    );
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await expect(probe.current.openStore()).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
    const error = onError.mock.calls[1][0];
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('STORE_URL_UNAVAILABLE');
    expect(error.cause).toMatchObject({ code: 'NOT_FOUND' });
    expect(openURL).not.toHaveBeenCalled();
    expect(probe.current).toMatchObject({
      status: 'ready',
      action: 'force',
      error: null,
    });

    // もう一度押せば再試行する
    mockFetchFixture('store/itunes-lookup.json');
    await expect(probe.current.openStore()).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
  });

  it('iOS: Linking.openURL fails → STORE_URL_UNAVAILABLE (cause: the original error) to onError, resolves false', async () => {
    const failure = new Error('cannot open');
    mockOpenURL(async () => {
      throw failure;
    });
    mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    await renderProvider(ios({ onError }), probe);
    await waitForStatus('ready');
    await expect(probe.current.openStore()).resolves.toBe(false);
    expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE']);
    expect(onError.mock.calls[0][0].cause).toBe(failure);
    expect(probe.current).toMatchObject({ status: 'ready', error: null });
  });

  it('Android: falls back to https when market:// fails (no onError)', async () => {
    setPlatform('android');
    const openURL = mockOpenURL(async (url) => {
      if (url.startsWith('market://')) {
        throw new Error('No Activity found to handle Intent');
      }
    });
    mockFetchFixture('store/playstore.html');
    const onError = createOnError();
    await renderProvider(android({ onError }), probe);
    await waitForStatus('ready');
    await expect(probe.current.openStore()).resolves.toBe(true);
    expect(openURL.mock.calls).toEqual([
      ['market://details?id=com.github.android'],
      [playUrl],
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('Android: both market:// and https fail → STORE_URL_UNAVAILABLE (cause: the https error) to onError, resolves false', async () => {
    setPlatform('android');
    const failure = new Error('no browser');
    mockOpenURL(async (url) => {
      throw url.startsWith('https://') ? failure : new Error('no market');
    });
    mockFetchFixture('store/playstore.html');
    const onError = createOnError();
    await renderProvider(android({ onError }), probe);
    await waitForStatus('ready');
    await expect(probe.current.openStore()).resolves.toBe(false);
    expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE']);
    expect(onError.mock.calls[0][0].cause).toBe(failure);
    expect(probe.current).toMatchObject({
      status: 'ready',
      action: 'warning',
      error: null,
    });
  });

  it('opens the store while checking (iOS: the lookup on press shares the running one)', async () => {
    const openURL = mockOpenURL();
    const { calls } = mockFetchPending();
    await renderProvider(
      ios({ bundleId: uniqueId(), onError: createOnError() }),
      probe
    );
    const opening = probe.current.openStore();
    await nextTask();
    expect(calls).toHaveLength(1);
    await act(async () => {
      calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    });
    await expect(opening).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
  });

  it('resolves false with STORE_URL_UNAVAILABLE to onError when the app was not detected (skipped)', async () => {
    const openURL = mockOpenURL();
    const onError = createOnError();
    await renderProvider(ios({ enabled: false, onError }), probe);
    await expect(probe.current.openStore()).resolves.toBe(false);
    expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE']);
    expect(openURL).not.toHaveBeenCalled();
    expect(probe.current.status).toBe('skipped');
  });

  it('resolves false before the check starts (mounted in the background)', async () => {
    appState = mockAppState('background');
    const openURL = mockOpenURL();
    const onError = createOnError();
    await renderProvider(ios({ onError }), probe);
    expect(probe.current.status).toBe('idle');
    await expect(probe.current.openStore()).resolves.toBe(false);
    expect(codesOf(onError)).toEqual(['STORE_URL_UNAVAILABLE']);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('does not reject when used as onPress as is (no unhandled rejection)', async () => {
    mockOpenURL(async () => {
      throw new Error('cannot open');
    });
    mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    await renderProvider(ios({ onError }), probe);
    await waitForStatus('ready');
    // 戻り値を捨てる呼び方（`onPress={openStore}`）。reject すれば setup の unhandled rejection の検出で落ちる
    const onPress: () => unknown = probe.current.openStore;
    onPress();
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await nextTask();
  });

  it('does not call onError after unmount, and resolves false', async () => {
    const failure = new Error('cannot open');
    let reject: (error: unknown) => void = () => {};
    mockOpenURL(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        })
    );
    mockFetchFixture('store/itunes-lookup.json');
    const onError = createOnError();
    const view = await renderProvider(ios({ onError }), probe);
    await waitForStatus('ready');
    const opening = probe.current.openStore();
    await nextTask();
    await view.unmount();
    reject(failure);
    await expect(opening).resolves.toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('country', () => {
  const mockLocale = (locale: unknown) =>
    jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ locale }),
        }) as Intl.DateTimeFormat
    );

  it('defaults to the region of the device locale', async () => {
    mockLocale('ja-JP');
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(
      { version: '1.282.0', bundleId: 'com.x', onError: createOnError() },
      probe
    );
    await waitForStatus('ready');
    expect(requestOf(spy).url).toMatch(/&country=jp&\d+$/);
  });

  it('uses the country prop over the locale', async () => {
    mockLocale('ja-JP');
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await renderProvider(
      ios({ country: 'us', onError: createOnError() }),
      probe
    );
    await waitForStatus('ready');
    expect(requestOf(spy).url).toMatch(/&country=us&\d+$/);
  });

  it.each([
    ['ja-JP', 'jp'],
    ['en-US', 'us'],
    ['en_GB', 'gb'],
    ['zh-Hant-TW', 'tw'],
    ['sr-Latn-RS-u-nu-latn', 'rs'],
    ['de-DE-u-co-phonebk', 'de'],
    ['es-419', 'us'],
    ['ja', 'us'],
    ['en-u-ca-gregory', 'us'],
    ['', 'us'],
    [undefined, 'us'],
  ])('defaultCountry(%s) → %s', (locale, expected) => {
    mockLocale(locale);
    expect(defaultCountry()).toBe(expected);
  });

  it('falls back to us when Intl throws', () => {
    jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('no Intl');
    });
    expect(defaultCountry()).toBe('us');
  });

  it('reads the real Intl without throwing', () => {
    expect(defaultCountry()).toMatch(/^[a-z]{2}$/);
  });
});
