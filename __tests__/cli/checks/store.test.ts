/**
 * @jest-environment node
 */
// C3: その ID でストアから引けるか（fetch はモックして fixture を返す。実ストアにはアクセスしない）
import { checkStore, STORE_TIMEOUT_MS } from '../../../src/cli/checks/store.ts';
import {
  createResponse,
  mockFetchFixture,
  mockFetchPending,
  mockFetchReject,
  mockFetchResponse,
  readFixture,
  requestOf,
} from '../../__helpers__/fetch.ts';

const bundleId = 'com.github.stormbreaker.prod';
const packageName = 'com.github.android';

describe('checkStore (C3)', () => {
  it('is skipped when there is no ID for either platform', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    for (const ids of [
      {},
      { ios: null, android: null },
      { ios: '', android: '' },
    ]) {
      await expect(checkStore(ids, { country: 'us' })).resolves.toEqual([
        {
          id: 'C3',
          level: 'skipped',
          message: 'no iOS bundleId or Android package to look up',
        },
      ]);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('looks up the bundleId on the App Store of the country and reports the version', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkStore({ ios: bundleId }, { country: 'us' })
    ).resolves.toEqual([
      {
        id: 'C3',
        level: 'ok',
        message: `bundleId "${bundleId}" is on the App Store (us) (version 1.283.0)`,
      },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(requestOf(spy).url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?bundleId=com\.github\.stormbreaker\.prod&country=us&\d+$/
    );
  });

  it('uses the given country', async () => {
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await checkStore({ ios: bundleId }, { country: 'jp' });
    expect(requestOf(spy).url).toContain('&country=jp&');
  });

  it('gets the package from Google Play and reports the version', async () => {
    const spy = mockFetchFixture('store/playstore.html');
    await expect(
      checkStore({ android: packageName }, { country: 'us' })
    ).resolves.toEqual([
      {
        id: 'C3',
        level: 'ok',
        message: `package "${packageName}" is on Google Play (version 1.283.0)`,
      },
    ]);
    expect(requestOf(spy).url).toBe(
      `https://play.google.com/store/apps/details?id=${packageName}`
    );
  });

  it('checks both platforms (iOS first)', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).startsWith('https://itunes.apple.com/')
          ? createResponse({ body: readFixture('store/itunes-lookup.json') })
          : createResponse({ status: 404 })
      );
    const entries = await checkStore(
      { ios: bundleId, android: packageName },
      { country: 'us' }
    );
    expect(entries.map(({ id, level }) => [id, level])).toEqual([
      ['C3', 'ok'],
      ['C3', 'warning'],
    ]);
  });

  it('warns that the app is not found on the App Store (NOT_FOUND)', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    await expect(
      checkStore({ ios: bundleId }, { country: 'us' })
    ).resolves.toEqual([
      {
        id: 'C3',
        level: 'warning',
        message: `bundleId "${bundleId}" is not found on the App Store (us): not published yet, a wrong ID, or not available in that country`,
      },
    ]);
  });

  it('warns that the app is not found on Google Play (NOT_FOUND)', async () => {
    mockFetchResponse('', 404);
    await expect(
      checkStore({ android: packageName }, { country: 'us' })
    ).resolves.toEqual([
      {
        id: 'C3',
        level: 'warning',
        message: `package "${packageName}" is not found on Google Play: not published yet, a wrong ID, or not available in the country of this network`,
      },
    ]);
  });

  it('warns (not errors) on the other failures, with the code', async () => {
    mockFetchReject(new TypeError('fetch failed'));
    await expect(
      checkStore({ ios: bundleId, android: packageName }, { country: 'us' })
    ).resolves.toEqual([
      {
        id: 'C3',
        level: 'warning',
        message: `could not look up bundleId "${bundleId}" on the App Store (us): NETWORK: request to https://itunes.apple.com/lookup?bundleId=${bundleId}&country=us failed`,
      },
      {
        id: 'C3',
        level: 'warning',
        message: `could not get package "${packageName}" from Google Play (access from CI can be unstable): NETWORK: request to https://play.google.com/store/apps/details?id=${packageName} failed`,
      },
    ]);
  });

  it.each([
    [
      'store/playstore-varies.html',
      'the Play Store page has no version for this app (Varies with device)',
    ],
    [
      'store/playstore-nonnumeric.html',
      'remote version is invalid: "50616-r-2026-11-03"',
    ],
  ])(
    'warns that %s is on Google Play but its version cannot be compared (INVALID_VERSION)',
    async (fixture, reason) => {
      mockFetchFixture(fixture);
      await expect(
        checkStore({ android: packageName }, { country: 'us' })
      ).resolves.toEqual([
        {
          id: 'C3',
          level: 'warning',
          message: `package "${packageName}" is on Google Play, but its version cannot be compared (${reason}). The store version cannot drive force / warning updates, so use getLatestVersion / getMinimumVersion`,
        },
      ]);
    }
  );

  it('warns when the Play Store page cannot be parsed', async () => {
    mockFetchResponse('<html></html>');
    await expect(
      checkStore({ android: packageName }, { country: 'us' })
    ).resolves.toEqual([
      {
        id: 'C3',
        level: 'warning',
        message: `could not get package "${packageName}" from Google Play (access from CI can be unstable): PARSE_FAILED: could not find the version in the Play Store page`,
      },
    ]);
  });

  it(`times out each request after ${STORE_TIMEOUT_MS}ms as a warning`, async () => {
    expect(STORE_TIMEOUT_MS).toBe(10_000);
    jest.useFakeTimers();
    const { calls } = mockFetchPending();
    const promise = checkStore(
      { ios: bundleId, android: packageName },
      { country: 'us' }
    );
    await jest.advanceTimersByTimeAsync(STORE_TIMEOUT_MS - 1);
    expect(calls.map((call) => call.aborted)).toEqual([false, false]);
    await jest.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining(
          `TIMEOUT: request to https://itunes.apple.com/lookup?bundleId=${bundleId}&country=us timed out after 10000ms`
        ),
      }),
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining(
          `TIMEOUT: request to https://play.google.com/store/apps/details?id=${packageName} timed out after 10000ms`
        ),
      }),
    ]);
    // タイムアウトした取得は止める（CLI のプロセスを残さない）
    expect(calls.map((call) => call.aborted)).toEqual([true, true]);
  });
});
