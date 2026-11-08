import { StoreVersionError } from '../../src/errors.ts';
import {
  extractPlayVersion,
  fetchAndroidVersion,
  playStoreUrl,
} from '../../src/fetchers/android.ts';
import {
  mockFetchFixture,
  mockFetchPending,
  mockFetchReject,
  mockFetchResponse,
  readFixture,
  requestOf,
} from '../__helpers__/fetch.ts';

const packageName = 'com.github.android';

const catchError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as StoreVersionError;
  }
  throw new Error('did not reject');
};

const extractError = (html: string) => {
  try {
    extractPlayVersion(html);
  } catch (error) {
    return error as StoreVersionError;
  }
  throw new Error('did not throw');
};

describe('fetchAndroidVersion', () => {
  it('builds the URL from the package name without any query (D41) and extracts the version (real page)', async () => {
    const spy = mockFetchFixture('store/playstore.html');
    await expect(fetchAndroidVersion({ packageName })).resolves.toEqual({
      version: '1.283.0',
      storeUrl:
        'https://play.google.com/store/apps/details?id=com.github.android',
    });
    const { url, init } = requestOf(spy);
    expect(url).toBe(
      'https://play.google.com/store/apps/details?id=com.github.android'
    );
    // iTunes と違い、タイムスタンプも no-cache も付けない
    expect(init?.headers).toBeUndefined();
  });

  it('fetches the given store URL as is (v1 compatible entry)', async () => {
    const spy = mockFetchFixture('store/playstore.html');
    const storeUrl =
      'https://play.google.com/store/apps/details?id=com.github.android&hl=ja';
    await expect(fetchAndroidVersion({ storeUrl })).resolves.toEqual({
      version: '1.283.0',
      storeUrl,
    });
    expect(requestOf(spy).url).toBe(storeUrl);
  });

  it.each([404, 500, 302])('throws NETWORK on status %d', async (status) => {
    mockFetchFixture('store/playstore.html', status);
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('NETWORK');
    expect(error.message).toContain(String(status));
  });

  it('throws NETWORK on a network error', async () => {
    const cause = new TypeError('Network request failed');
    mockFetchReject(cause);
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('NETWORK');
    expect(error.cause).toBe(cause);
  });

  it('throws TIMEOUT after timeoutMs', async () => {
    jest.useFakeTimers();
    mockFetchPending();
    const promise = catchError(
      fetchAndroidVersion({ packageName: 'timeout.android' }, { timeoutMs: 10 })
    );
    await jest.advanceTimersByTimeAsync(10);
    expect((await promise).code).toBe('TIMEOUT');
  });

  it('throws PARSE_FAILED for a changed page (real fixture)', async () => {
    mockFetchFixture('store/playstore-changed.html');
    expect((await catchError(fetchAndroidVersion({ packageName }))).code).toBe(
      'PARSE_FAILED'
    );
  });

  it('throws INVALID_VERSION when the version slot is empty (Varies with device, real fixture)', async () => {
    mockFetchFixture('store/playstore-varies.html');
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('INVALID_VERSION');
    expect(error.message).toContain('Varies with device');
  });

  it('throws INVALID_VERSION for a non-numeric versionName (real fixture)', async () => {
    mockFetchFixture('store/playstore-nonnumeric.html');
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('INVALID_VERSION');
    expect(error.message).toBe(
      'remote version is invalid: "50616-r-2026-11-03"'
    );
  });
});

describe('extractPlayVersion', () => {
  it('skips the decoy reviews that hold an older version (real page)', () => {
    const html = readFixture('store/playstore.html');
    expect(html).toContain('"1.274.0"');
    expect(extractPlayVersion(html)).toBe('1.283.0');
  });

  it('falls back to the v1 pattern', () => {
    expect(extractPlayVersion('xx[[["4.5.6"]],yy')).toBe('4.5.6');
    expect(extractPlayVersion("xx[[['4.5.6']],yy")).toBe('4.5.6');
  });

  it('prefers the version slot to the v1 pattern', () => {
    expect(
      extractPlayVersion(
        '[[["1.0.0"]],decoy,null,null,null,[[["2.0.0"]],[[[37]],[[[26,"8.0"]]]]]'
      )
    ).toBe('2.0.0');
  });

  it('treats an empty version slot as Varies even if the v1 pattern matches elsewhere', () => {
    const html =
      '[[["9.9.9"]],decoy,null,null,null,[[null,[]],[[[28,"9"]],[null,[]]]],null,null,null,';
    expect(extractError(html).code).toBe('INVALID_VERSION');
  });

  it('throws INVALID_VERSION for a 5-part version from the v1 pattern', () => {
    expect(extractError('[[["1.2.3.4.5"]],').code).toBe('INVALID_VERSION');
  });

  it('throws PARSE_FAILED when nothing matches', () => {
    expect(extractError('<html></html>')).toMatchObject({
      code: 'PARSE_FAILED',
      message: 'could not find the version in the Play Store page',
    });
  });
});

describe('playStoreUrl', () => {
  it('builds the details URL', () => {
    expect(playStoreUrl(packageName)).toBe(
      'https://play.google.com/store/apps/details?id=com.github.android'
    );
  });

  it('is what fetchAndroidVersion requests', async () => {
    const spy = mockFetchResponse('[[["1.0.0"]],');
    await fetchAndroidVersion({ packageName: 'org.example.app' });
    expect(requestOf(spy).url).toBe(playStoreUrl('org.example.app'));
  });
});
