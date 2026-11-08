import checkVersion, { compareVersion } from '../src/index.ts';
import { mockFetchFixture, mockFetchReject } from './__helpers__/fetch.ts';
import { setPlatform } from './__helpers__/platform.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

const iosStoreURL = 'https://apps.apple.com/jp/app/github/id1477376905';
const androidStoreURL =
  'https://play.google.com/store/apps/details?id=com.github.android';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('compareVersion', () => {
  it('returns old when remote is older than local', () => {
    expect(compareVersion('1.1.0', '1.0.3')).toBe('old');
  });

  it('returns new when remote is newer than local', () => {
    expect(compareVersion('1.0.0', '1.1.0')).toBe('new');
  });

  it('returns equal when versions are the same', () => {
    expect(compareVersion('1.1.0', '1.1.0')).toBe('equal');
  });
});

describe('checkVersion (ios)', () => {
  beforeEach(() => {
    setPlatform('ios');
  });

  it('returns local / remote / result / detail', async () => {
    mockFetchFixture('itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).resolves.toEqual({
      local: '1.0.0',
      remote: '1.2.3',
      result: 'new',
      detail: 'remote > local',
    });
  });

  it('returns old / remote < local', async () => {
    mockFetchFixture('itunes-lookup.json');
    await expect(
      checkVersion({ version: '2.0.0', iosStoreURL })
    ).resolves.toEqual({
      local: '2.0.0',
      remote: '1.2.3',
      result: 'old',
      detail: 'remote < local',
    });
  });

  it('returns equal / remote === local', async () => {
    mockFetchFixture('itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.2.3', iosStoreURL })
    ).resolves.toEqual({
      local: '1.2.3',
      remote: '1.2.3',
      result: 'equal',
      detail: 'remote === local',
    });
  });

  it('defaults country to jp', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await checkVersion({ version: '1.0.0', iosStoreURL });
    expect(String(spy.mock.calls[0][0])).toContain('country=jp');
  });

  it('passes the given country', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await checkVersion({ version: '1.0.0', iosStoreURL, country: 'us' });
    expect(String(spy.mock.calls[0][0])).toContain('country=us');
  });

  it('throws when local version is not set', async () => {
    await expect(checkVersion({ version: '', iosStoreURL })).rejects.toThrow(
      'local version is not set.'
    );
  });

  it('throws when iosStoreURL is not set', async () => {
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      'iosStoreURL is not set.'
    );
  });

  it('throws when iosStoreURL is invalid', async () => {
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL: 'https://example.com/' })
    ).rejects.toThrow('iosStoreURL is invalid.');
  });

  it('throws when the app is not released', async () => {
    mockFetchFixture('itunes-lookup-empty.json');
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).rejects.toThrow('appID(1477376905) is not released.');
  });

  it('rethrows fetch errors with the same message', async () => {
    mockFetchReject(new Error('Network request failed'));
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).rejects.toThrow('Network request failed');
  });
});

describe('checkVersion (android)', () => {
  beforeEach(() => {
    setPlatform('android');
  });

  it('returns local / remote / result / detail', async () => {
    mockFetchFixture('playstore.html');
    await expect(
      checkVersion({ version: '4.0.0', androidStoreURL })
    ).resolves.toEqual({
      local: '4.0.0',
      remote: '4.5.6',
      result: 'new',
      detail: 'remote > local',
    });
  });

  it('does not require iosStoreURL', async () => {
    mockFetchFixture('playstore.html');
    await expect(
      checkVersion({ version: '4.5.6', androidStoreURL })
    ).resolves.toMatchObject({ result: 'equal', detail: 'remote === local' });
  });

  it('throws when local version is not set', async () => {
    await expect(
      checkVersion({ version: '', androidStoreURL })
    ).rejects.toThrow('local version is not set.');
  });

  it('throws when androidStoreURL is not set', async () => {
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      'androidStoreURL is not set.'
    );
  });

  it('throws when androidStoreURL is invalid', async () => {
    await expect(
      checkVersion({
        version: '1.0.0',
        androidStoreURL: 'https://example.com/',
      })
    ).rejects.toThrow('androidStoreURL is invalid.');
  });

  it("throws when the version can't be found", async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      text: async () => '<html></html>',
    } as Response);
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).rejects.toThrow("can't get android app version.");
  });
});
