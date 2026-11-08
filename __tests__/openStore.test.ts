import { StoreVersionError } from '../src/errors.ts';
import type { StoreUrlResult } from '../src/fetchers/ios.ts';
import { openStore } from '../src/openStore.ts';
import { resolve } from '../src/resolve.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  readFixture,
} from './__helpers__/fetch.ts';
import { canOpenURLMock, mockOpenURL } from './__helpers__/linking.ts';

const trackViewUrl = 'https://apps.apple.com/jp/app/github/id1477376905?uo=4';

let seq = 0;
const uniqueId = () => {
  seq += 1;
  return `com.example.open${seq}`;
};

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

const unavailable = (): StoreUrlResult => ({
  storeUrl: null,
  error: new StoreVersionError('STORE_URL_UNAVAILABLE', 'failed at launch'),
});

describe('openStore (iOS)', () => {
  it('opens the URL the launch lookup already got, without looking up again', async () => {
    const openURL = mockOpenURL();
    const spy = jest.spyOn(globalThis, 'fetch');
    await openStore({
      platform: 'ios',
      appId: 'com.github.stormbreaker.prod',
      country: 'jp',
      storeUrl: Promise.resolve({ storeUrl: trackViewUrl, error: null }),
    });
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(spy).not.toHaveBeenCalled();
  });

  it('waits for the lookup still in progress, then opens it', async () => {
    const openURL = mockOpenURL();
    const { calls } = mockFetchPending();
    const appId = uniqueId();
    // getLatestVersion を使うと、判定が先に出て URL の lookup は取得中のまま
    const result = await resolve({
      platform: 'ios',
      version: '1.0.0',
      appId,
      country: 'jp',
      getLatestVersion: async () => '2.0.0',
    });
    expect(result.storeUrl).toBeNull();
    const opening = openStore({
      platform: 'ios',
      appId,
      country: 'jp',
      storeUrl: result.storeUrlResult,
    });
    await nextTask();
    expect(openURL).not.toHaveBeenCalled();
    calls[0].respond({ body: readFixture('store/itunes-lookup.json') });
    await opening;
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
    expect(calls).toHaveLength(1);
  });

  it('looks up again on the spot when the launch lookup failed', async () => {
    const openURL = mockOpenURL();
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await openStore({
      platform: 'ios',
      appId: 'com.github.stormbreaker.prod',
      country: 'us',
      storeUrl: Promise.resolve(unavailable()),
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?bundleId=com\.github\.stormbreaker\.prod&country=us&\d+$/
    );
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
  });

  it('looks up when no launch lookup is given', async () => {
    const openURL = mockOpenURL();
    mockFetchFixture('store/itunes-lookup.json');
    await openStore({
      platform: 'ios',
      appId: 'com.github.stormbreaker.prod',
      country: 'jp',
    });
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
  });

  it('rejects with STORE_URL_UNAVAILABLE when the second lookup also fails, and retries on the next press', async () => {
    const openURL = mockOpenURL();
    const spy = mockFetchFixture('store/itunes-lookup-empty.json');
    const params = {
      platform: 'ios' as const,
      appId: 'com.github.stormbreaker.prod',
      country: 'jp',
      storeUrl: Promise.resolve(unavailable()),
    };
    const error = await catchError(openStore(params));
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('STORE_URL_UNAVAILABLE');
    expect(error.cause).toMatchObject({ code: 'NOT_FOUND' });
    expect(openURL).not.toHaveBeenCalled();

    mockFetchFixture('store/itunes-lookup.json');
    await openStore(params);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenCalledWith(trackViewUrl);
  });

  it('applies timeoutMs to the second lookup', async () => {
    jest.useFakeTimers();
    mockOpenURL();
    mockFetchPending();
    const promise = catchError(
      openStore({
        platform: 'ios',
        appId: uniqueId(),
        country: 'jp',
        timeoutMs: 3000,
      })
    );
    await jest.advanceTimersByTimeAsync(3000);
    const error = await promise;
    expect(error.code).toBe('STORE_URL_UNAVAILABLE');
    expect(error.cause).toMatchObject({ code: 'TIMEOUT' });
  });

  it('passes the error of Linking.openURL through', async () => {
    const failure = new Error('cannot open');
    mockOpenURL(async () => {
      throw failure;
    });
    await expect(
      openStore({
        platform: 'ios',
        appId: 'x',
        country: 'jp',
        storeUrl: Promise.resolve({ storeUrl: trackViewUrl, error: null }),
      })
    ).rejects.toBe(failure);
  });
});

describe('openStore (Android)', () => {
  it('opens market:// first', async () => {
    const openURL = mockOpenURL();
    const spy = jest.spyOn(globalThis, 'fetch');
    await openStore({
      platform: 'android',
      appId: 'com.github.android',
      country: 'jp',
    });
    expect(openURL.mock.calls).toEqual([
      ['market://details?id=com.github.android'],
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(canOpenURLMock()).not.toHaveBeenCalled();
  });

  it('falls back to https when market:// fails', async () => {
    const openURL = mockOpenURL(async (url) => {
      if (url.startsWith('market://')) {
        throw new Error('No Activity found to handle Intent');
      }
    });
    await openStore({
      platform: 'android',
      appId: 'com.github.android',
      country: 'jp',
    });
    expect(openURL.mock.calls).toEqual([
      ['market://details?id=com.github.android'],
      ['https://play.google.com/store/apps/details?id=com.github.android'],
    ]);
    expect(canOpenURLMock()).not.toHaveBeenCalled();
  });

  it('rejects with the https error when both fail', async () => {
    const failure = new Error('no browser');
    mockOpenURL(async (url) => {
      throw url.startsWith('https://') ? failure : new Error('no market');
    });
    await expect(
      openStore({ platform: 'android', appId: 'com.x', country: 'jp' })
    ).rejects.toBe(failure);
  });

  it('ignores the storeUrl given for iOS', async () => {
    const openURL = mockOpenURL();
    await openStore({
      platform: 'android',
      appId: 'com.github.android',
      country: 'jp',
      storeUrl: Promise.resolve({ storeUrl: trackViewUrl, error: null }),
    });
    expect(openURL).toHaveBeenCalledWith(
      'market://details?id=com.github.android'
    );
  });
});
