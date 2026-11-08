import { StoreVersionError } from '../../src/errors.ts';
import {
  appIdFromStoreUrl,
  lookupIOS,
  lookupStoreUrl,
  lookupUrl,
} from '../../src/fetchers/ios.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  mockFetchReject,
  mockFetchResponse,
  requestOf,
} from '../__helpers__/fetch.ts';

const bundleId = 'com.github.stormbreaker.prod';

const catchError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as StoreVersionError;
  }
  throw new Error('did not reject');
};

describe('lookupIOS', () => {
  it('looks up by bundleId and returns version / trackViewUrl / releaseNotes (real fixture)', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await expect(lookupIOS({ bundleId }, 'jp')).resolves.toEqual({
      version: '1.283.0',
      storeUrl: 'https://apps.apple.com/jp/app/github/id1477376905?uo=4',
      releaseNotes: "What's new\n\n…",
    });
    const { url, init } = requestOf(spy);
    expect(url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?bundleId=com\.github\.stormbreaker\.prod&country=jp&\d+$/
    );
    expect(init?.headers).toEqual({ 'cache-control': 'no-cache' });
  });

  it('looks up by the numeric id taken from the store URL (v1 style)', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    const appId = appIdFromStoreUrl(
      'https://apps.apple.com/jp/app/github/id1477376905'
    );
    expect(appId).toBe('1477376905');
    await expect(
      lookupIOS({ appId: appId as string }, 'us')
    ).resolves.toMatchObject({ version: '1.283.0' });
    expect(requestOf(spy).url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?id=1477376905&country=us&\d+$/
    );
  });

  it('builds the lookup URL without the timestamp and encodes the values', () => {
    expect(lookupUrl({ bundleId: 'a b' }, 'j&p')).toBe(
      'https://itunes.apple.com/lookup?bundleId=a%20b&country=j%26p'
    );
  });

  it('throws NOT_FOUND when results is empty (real fixture)', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    const error = await catchError(lookupIOS({ bundleId }, 'jp'));
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toContain(bundleId);
  });

  it('names the numeric id in NOT_FOUND for the URL style', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    const error = await catchError(lookupIOS({ appId: '1477376905' }, 'jp'));
    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      message:
        'the app (appId "1477376905") is not found on the App Store (jp)',
    });
  });

  it.each([
    ['no results key', '{"resultCount":0}'],
    ['null', 'null'],
    ['results is not an array', '{"results":{}}'],
  ])('throws NOT_FOUND when %s', async (_, body) => {
    mockFetchResponse(body);
    expect((await catchError(lookupIOS({ bundleId }, 'jp'))).code).toBe(
      'NOT_FOUND'
    );
  });

  it('throws NETWORK with the cause when the response is not JSON (D47)', async () => {
    mockFetchResponse('<html>error</html>');
    const error = await catchError(lookupIOS({ bundleId }, 'jp'));
    expect(error.code).toBe('NETWORK');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    ['missing', '{"results":[{"trackViewUrl":"x"}]}'],
    ['a number', '{"results":[{"version":1}]}'],
    ['a null result', '{"results":[null]}'],
  ])('throws NETWORK when results[0].version is %s (D47)', async (_, body) => {
    mockFetchResponse(body);
    expect((await catchError(lookupIOS({ bundleId }, 'jp'))).code).toBe(
      'NETWORK'
    );
  });

  it('throws NETWORK on an HTTP error', async () => {
    mockFetchResponse('{"results":[{"version":"1.0.0"}]}', 503);
    const error = await catchError(lookupIOS({ bundleId }, 'jp'));
    expect(error.code).toBe('NETWORK');
    expect(error.message).toContain('503');
  });

  it('throws NETWORK on a network error', async () => {
    const cause = new TypeError('Network request failed');
    mockFetchReject(cause);
    const error = await catchError(lookupIOS({ bundleId }, 'jp'));
    expect(error.code).toBe('NETWORK');
    expect(error.cause).toBe(cause);
  });

  it('throws TIMEOUT after timeoutMs', async () => {
    jest.useFakeTimers();
    mockFetchPending();
    const promise = catchError(
      lookupIOS({ bundleId: 'timeout.ios' }, 'jp', { timeoutMs: 500 })
    );
    await jest.advanceTimersByTimeAsync(500);
    expect((await promise).code).toBe('TIMEOUT');
  });

  it('returns null storeUrl and no releaseNotes when the result has neither', async () => {
    mockFetchResponse('{"results":[{"version":"2.0.0","trackViewUrl":""}]}');
    await expect(lookupIOS({ bundleId }, 'jp')).resolves.toEqual({
      version: '2.0.0',
      storeUrl: null,
    });
  });

  it('returns a non-comparable version as is (the judgment reports it)', async () => {
    mockFetchResponse('{"results":[{"version":"Varies"}]}');
    await expect(lookupIOS({ bundleId }, 'jp')).resolves.toMatchObject({
      version: 'Varies',
    });
  });
});

describe('appIdFromStoreUrl', () => {
  it.each([
    ['https://apps.apple.com/jp/app/github/id1477376905', '1477376905'],
    ['https://apps.apple.com/jp/app/id1477376905?l=en', '1477376905'],
    ['https://example.com/', null],
    ['', null],
  ])('%s -> %p', (url, expected) => {
    expect(appIdFromStoreUrl(url)).toBe(expected);
  });
});

describe('lookupStoreUrl', () => {
  it('returns trackViewUrl', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(lookupStoreUrl(bundleId, 'jp')).resolves.toEqual({
      storeUrl: 'https://apps.apple.com/jp/app/github/id1477376905?uo=4',
      error: null,
    });
  });

  it('resolves (does not reject) with STORE_URL_UNAVAILABLE and the lookup error as the cause', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    const result = await lookupStoreUrl(bundleId, 'jp');
    expect(result.storeUrl).toBeNull();
    expect(result.error).toMatchObject({ code: 'STORE_URL_UNAVAILABLE' });
    expect(result.error?.cause).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns STORE_URL_UNAVAILABLE when trackViewUrl is missing', async () => {
    mockFetchResponse('{"results":[{"version":"2.0.0"}]}');
    const result = await lookupStoreUrl(bundleId, 'jp');
    expect(result.error).toMatchObject({
      code: 'STORE_URL_UNAVAILABLE',
      message: 'iTunes Lookup returned no trackViewUrl',
    });
  });
});
