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

  // v1（compare-versions 4.1.x（^4.1.3。現在の解決は 4.1.4））の実際の結果。Phase 2 で compare-versions を取り込み直しても変わらないことを保証する
  it.each([
    ['1.0', '1.0.0', 'equal'],
    ['1.0.0', '1.0', 'equal'],
    ['1', '1.0.0', 'equal'],
    ['1.2.3', '1.2.3.1', 'new'],
    ['1.2.3.1', '1.2.3', 'old'],
    ['1.0.0.0', '1.0.0', 'equal'],
    ['1.0.0-beta', '1.0.0', 'new'],
    ['1.0.0', '1.0.0-beta', 'old'],
    ['1.0.0-alpha', '1.0.0-beta', 'new'],
    ['1.0.0-rc.1', '1.0.0-rc.2', 'new'],
    ['v1.0.0', '1.0.0', 'equal'],
    ['1.0.0', 'v1.0.0', 'equal'],
    ['1.0.0+build', '1.0.0', 'equal'],
    ['1.10.0', '1.9.0', 'old'],
    ['2024.01.15', '2024.1.16', 'new'],
    // 先頭ゼロを数値として比べていること（文字列比較なら '09' < '1' で new になる）
    ['2024.01.15', '2024.1.15', 'equal'],
    ['2024.09.01', '2024.1.1', 'old'],
  ])('compareVersion(%j, %j) returns %s', (local, remote, expected) => {
    expect(compareVersion(local, remote)).toBe(expected);
  });

  it.each([
    ['abc', '1.0.0', "Invalid argument not valid semver ('abc' received)"],
    ['1.0.0', 'abc', "Invalid argument not valid semver ('abc' received)"],
    ['', '1.0.0', "Invalid argument not valid semver ('' received)"],
    [
      '1.2.3.4.5',
      '1.0.0',
      "Invalid argument not valid semver ('1.2.3.4.5' received)",
    ],
  ])('compareVersion(%j, %j) throws', (local, remote, message) => {
    expect(() => compareVersion(local, remote)).toThrow(new Error(message));
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

  // compareVersion は checkVersion の try の外にあるので、local が不正だとそのメッセージがそのまま利用者に届く
  it('throws the compare-versions error when local version is invalid', async () => {
    mockFetchFixture('itunes-lookup.json');
    await expect(checkVersion({ version: 'abc', iosStoreURL })).rejects.toThrow(
      new Error("Invalid argument not valid semver ('abc' received)")
    );
  });

  it('throws when local version is not set', async () => {
    await expect(checkVersion({ version: '', iosStoreURL })).rejects.toThrow(
      new Error('local version is not set.')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when iosStoreURL is not set', async () => {
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      new Error('iosStoreURL is not set.')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when iosStoreURL is invalid', async () => {
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL: 'https://example.com/' })
    ).rejects.toThrow(new Error('iosStoreURL is invalid.'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when the app is not released', async () => {
    mockFetchFixture('itunes-lookup-empty.json');
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).rejects.toThrow(new Error('appID(1477376905) is not released.'));
  });

  it('rethrows fetch errors with the same message', async () => {
    mockFetchReject(new Error('Network request failed'));
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).rejects.toThrow(new Error('Network request failed'));
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
    ).rejects.toThrow(new Error('local version is not set.'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when androidStoreURL is not set', async () => {
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      new Error('androidStoreURL is not set.')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when androidStoreURL is invalid', async () => {
    await expect(
      checkVersion({
        version: '1.0.0',
        androidStoreURL: 'https://example.com/',
      })
    ).rejects.toThrow(new Error('androidStoreURL is invalid.'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("throws when the version can't be found", async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      text: async () => '<html></html>',
    } as Response);
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).rejects.toThrow(new Error("can't get android app version."));
  });
});
