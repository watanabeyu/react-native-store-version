// v1 互換の checkVersion（src/checkVersion.ts）のテスト。1c の回帰テスト（index.test.ts / index.store-fixtures.test.ts）は
// 変えずに残し、ここでは 2d で足したもの（省略した引数の自動取得 / timeoutMs / ios・android 以外の OS / v1 のメッセージとの対応表の全行）と、
// v1 の src/ios.ts / src/android.ts を消すときに __tests__/ios.test.ts / android.test.ts から移した 9 件（[ios-N] / [android-N]）を確かめる
import { checkVersion } from '../src/checkVersion.ts';
import { compareVersion } from '../src/compare.ts';
import { StoreVersionError } from '../src/errors.ts';
import {
  createResponse,
  mockFetchFixture,
  mockFetchPending,
  mockFetchReject,
  mockFetchResponse,
  requestOf,
} from './__helpers__/fetch.ts';
import { setOptionalModules } from './__helpers__/modules.ts';
import { setPlatform } from './__helpers__/platform.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

const iosStoreURL = 'https://apps.apple.com/jp/app/github/id1477376905';
const androidStoreURL =
  'https://play.google.com/store/apps/details?id=com.github.android';

const expoApplication = {
  nativeApplicationVersion: '1.0.0',
  applicationId: 'com.example.app',
};

const catchError = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('did not reject');
};

/** 投げた値の message（v1 がそのまま投げ直す、JS エンジンが作るメッセージの期待値を作る） */
const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('did not throw');
};

/** fetch が `text()` で reject する Response を返す */
const mockFetchTextReject = (error: unknown, status = 200) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,
    text: async () => {
      throw error;
    },
  } as unknown as Response);

beforeEach(() => {
  setPlatform('ios');
  // 既定では expo-application / react-native-device-info は入っていない（自動取得できない）
  setOptionalModules();
});

describe('moved from __tests__/ios.test.ts (v1 getIOSVersion, via checkVersion)', () => {
  it('[ios-1] returns the version of the first result', async () => {
    mockFetchFixture('itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).resolves.toMatchObject({ remote: '1.2.3' });
  });

  it('[ios-2] defaults country to jp, appends the timestamp and sends no-cache', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await checkVersion({ version: '1.0.0', iosStoreURL });
    const { url, init } = requestOf(spy);
    expect(url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?id=1477376905&country=jp&\d+$/
    );
    // v1 は `{ headers }` だけ。v2 は request の層が abort 用の signal も渡す（それ以外は同じ）
    expect(init?.headers).toEqual({ 'cache-control': 'no-cache' });
    expect(Object.keys(init ?? {}).sort()).toEqual(['headers', 'signal']);
  });

  it('[ios-3] uses the given country', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await checkVersion({
      version: '1.0.0',
      iosStoreURL: 'https://apps.apple.com/us/app/github/id1477376905',
      country: 'us',
    });
    expect(requestOf(spy).url).toContain('country=us');
  });

  // v1 の getIOSVersion() は既定引数の '' で invalid だった。checkVersion では URL の省略は「not set」の経路（v1 と同じ）
  it('[ios-4] throws when the url is invalid (and when it is not set) without fetching', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL: 'https://example.com/' })
    ).rejects.toThrow(new Error('iosStoreURL is invalid.'));
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      new Error('iosStoreURL is not set.')
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('[ios-5] throws when the app is not released', async () => {
    mockFetchFixture('itunes-lookup-empty.json');
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).rejects.toThrow(new Error('appID(1477376905) is not released.'));
  });
});

describe('moved from __tests__/android.test.ts (v1 getAndroidVersion, via checkVersion)', () => {
  beforeEach(() => {
    setPlatform('android');
  });

  it('[android-1] extracts the version from the page and fetches the given URL as is', async () => {
    const spy = mockFetchFixture('playstore.html');
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).resolves.toMatchObject({ remote: '4.5.6' });
    expect(requestOf(spy).url).toBe(androidStoreURL);
  });

  // v1 の getAndroidVersion() は既定引数の '' で invalid だった。checkVersion では、Android での省略は「not set」、
  // ios / android 以外での省略は v1 と同じく invalid（下の「Platform.OS が ios / android 以外」でも確かめる）
  it('[android-2] throws when the url is invalid (and when it is not set) without fetching', async () => {
    const spy = mockFetchFixture('playstore.html');
    await expect(
      checkVersion({
        version: '1.0.0',
        androidStoreURL: 'https://example.com/',
      })
    ).rejects.toThrow(new Error('androidStoreURL is invalid.'));
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      new Error('androidStoreURL is not set.')
    );
    setPlatform('web');
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      new Error('androidStoreURL is invalid.')
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('[android-3] throws when the response status is not 200', async () => {
    mockFetchResponse('not found', 404);
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).rejects.toThrow(new Error('androidStoreURL is invalid.'));
  });

  it("[android-4] throws when the version can't be found", async () => {
    mockFetchResponse('<html></html>');
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).rejects.toThrow(new Error("can't get android app version."));
  });
});

// src/checkVersion.ts の先頭のコメントの対応表の各行。期待するメッセージは v1 の src/index.ts / ios.ts / android.ts の挙動
describe('v1 messages (iOS, iosStoreURL given: same handling as v1)', () => {
  const syntaxErrorMessage = messageOf(() => JSON.parse('<html>'));

  it.each<[string, () => unknown, string]>([
    [
      'fetch rejects with an Error → its message',
      () => mockFetchReject(new Error('Network request failed')),
      'Network request failed',
    ],
    [
      "fetch rejects with a non-Error → can't get ios version",
      () => mockFetchReject('boom'),
      "can't get ios version",
    ],
    [
      'text() rejects with an Error → its message',
      () => mockFetchTextReject(new Error('body read failed')),
      'body read failed',
    ],
    [
      "text() rejects with a non-Error → can't get ios version",
      () => mockFetchTextReject(undefined),
      "can't get ios version",
    ],
    [
      'the body is not JSON → the JSON.parse message',
      () => mockFetchResponse('<html>'),
      syntaxErrorMessage,
    ],
    [
      'the body is not JSON and the status is not 200 → the JSON.parse message (v1 does not look at the status)',
      () => mockFetchResponse('<html>', 503),
      syntaxErrorMessage,
    ],
    [
      'results is empty → not released',
      () => mockFetchFixture('itunes-lookup-empty.json'),
      'appID(1477376905) is not released.',
    ],
    [
      'results is missing → not released',
      () => mockFetchResponse('{"resultCount":0}'),
      'appID(1477376905) is not released.',
    ],
    [
      'the response is null → not released',
      () => mockFetchResponse('null'),
      'appID(1477376905) is not released.',
    ],
    [
      'a JSON error with status 400 → not released (v1 reads the body regardless of the status)',
      () =>
        mockFetchResponse(
          '{"errorMessage":"Invalid value(s) for key(s): [country]"}',
          400
        ),
      'appID(1477376905) is not released.',
    ],
    [
      'results[0] is null → the TypeError message',
      () => mockFetchResponse('{"results":[null]}'),
      messageOf(() => (null as unknown as { version: string }).version),
    ],
  ])('%s', async (_, mock, message) => {
    mock();
    const error = await catchError(
      checkVersion({ version: '1.0.0', iosStoreURL })
    );
    expect(error).toEqual(new Error(message));
    // v1 と同じく、StoreVersionError ではなく素の Error
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
  });

  it('uses the body even when the status is not 200 (v1 does not look at the status)', async () => {
    mockFetchFixture('itunes-lookup.json', 404);
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).resolves.toMatchObject({ remote: '1.2.3', result: 'new' });
  });

  it('does not encode country (same URL as v1)', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await checkVersion({
      version: '1.0.0',
      iosStoreURL,
      country: 'us&lang=ja',
    });
    expect(requestOf(spy).url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?id=1477376905&country=us&lang=ja&\d+$/
    );
  });

  it('uses jp when country is an empty string', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await checkVersion({ version: '1.0.0', iosStoreURL, country: '' });
    expect(requestOf(spy).url).toContain('country=jp&');
  });

  // v1 の正規表現 `/.+id([0-9]+)\??/` は貪欲なので、最後の `id<数字>` を取る
  it('takes the last id<digits> in the URL (v1 regex)', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await checkVersion({
      version: '1.0.0',
      iosStoreURL: 'https://apps.apple.com/jp/app/id9-app/id1477376905?l=en',
    });
    expect(requestOf(spy).url).toContain('?id=1477376905&');
  });

  // 比較は try の外なので、compare-versions が投げたもの（文字列でない値は TypeError）が包まれずにそのまま届く
  it('throws the compare-versions error as is when results[0].version is not a string', async () => {
    mockFetchResponse('{"results":[{"version":123}]}');
    const expected = (() => {
      try {
        compareVersion('1.0.0', 123 as unknown as string);
      } catch (error) {
        return error as Error;
      }
      throw new Error('did not throw');
    })();
    const error = await catchError(
      checkVersion({ version: '1.0.0', iosStoreURL })
    );
    expect(error).toEqual(expected);
    expect(Object.getPrototypeOf(error)).toBe(Object.getPrototypeOf(expected));
  });

  it('throws the compare-versions message as is when the local version is invalid', async () => {
    mockFetchFixture('itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.2.3.4.5', iosStoreURL })
    ).rejects.toThrow(
      new Error("Invalid argument not valid semver ('1.2.3.4.5' received)")
    );
  });
});

describe('v1 messages (iOS, bundleId detected: lookupIOS codes mapped to v1 messages)', () => {
  beforeEach(() => {
    setOptionalModules({ 'expo-application': expoApplication });
  });

  it.each<[string, () => unknown, string]>([
    [
      'NETWORK (fetch rejects with an Error) → its message',
      () => mockFetchReject(new Error('Network request failed')),
      'Network request failed',
    ],
    [
      "NETWORK (fetch rejects with a non-Error) → can't get ios version",
      () => mockFetchReject({ reason: 'offline' }),
      "can't get ios version",
    ],
    [
      'NETWORK (the body is not JSON) → the JSON.parse message',
      () => mockFetchResponse('<html>'),
      messageOf(() => JSON.parse('<html>')),
    ],
    [
      "NETWORK (status is not 200) → can't get ios version",
      () => mockFetchFixture('itunes-lookup.json', 503),
      "can't get ios version",
    ],
    [
      "NETWORK (results[0].version is not a string) → can't get ios version",
      () => mockFetchResponse('{"results":[{}]}'),
      "can't get ios version",
    ],
    [
      'NOT_FOUND → not released (with the bundleId)',
      () => mockFetchFixture('store/itunes-lookup-empty.json'),
      'appID(com.example.app) is not released.',
    ],
  ])('%s', async (_, mock, message) => {
    mock();
    const error = await catchError(checkVersion());
    expect(error).toEqual(new Error(message));
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
  });
});

describe('v1 messages (Android: androidStoreURL given or package name detected)', () => {
  beforeEach(() => {
    setPlatform('android');
  });

  const cases: [string, () => unknown, string][] = [
    [
      'NETWORK (fetch rejects with an Error) → its message',
      () => mockFetchReject(new Error('Network request failed')),
      'Network request failed',
    ],
    [
      "NETWORK (fetch rejects with a non-Error) → can't get android version",
      () => mockFetchReject(null),
      "can't get android version",
    ],
    [
      'NETWORK (text() rejects with an Error) → its message',
      () => mockFetchTextReject(new Error('body read failed')),
      'body read failed',
    ],
    [
      'status is not 200 → androidStoreURL is invalid.',
      () => mockFetchResponse('', 500),
      'androidStoreURL is invalid.',
    ],
    [
      "PARSE_FAILED (no pattern matches) → can't get android app version.",
      () => mockFetchFixture('store/playstore-changed.html'),
      "can't get android app version.",
    ],
    [
      "INVALID_VERSION (Varies with device) → can't get android app version.",
      () => mockFetchFixture('store/playstore-varies.html'),
      "can't get android app version.",
    ],
    [
      "INVALID_VERSION (non-numeric versionName) → can't get android app version.",
      () => mockFetchFixture('store/playstore-nonnumeric.html'),
      "can't get android app version.",
    ],
  ];

  it.each(cases)('[url] %s', async (_, mock, message) => {
    mock();
    const error = await catchError(
      checkVersion({ version: '1.0.0', androidStoreURL })
    );
    expect(error).toEqual(new Error(message));
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
  });

  it.each(cases)('[package name] %s', async (_, mock, message) => {
    setOptionalModules({ 'expo-application': expoApplication });
    mock();
    const error = await catchError(checkVersion());
    expect(error).toEqual(new Error(message));
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
  });

  it('extracts the version from the real page', async () => {
    mockFetchFixture('store/playstore.html');
    await expect(
      checkVersion({ version: '1.283.0', androidStoreURL })
    ).resolves.toEqual({
      local: '1.283.0',
      remote: '1.283.0',
      result: 'equal',
      detail: 'remote === local',
    });
  });

  it('fetches the given URL as is (query kept, nothing added)', async () => {
    const spy = mockFetchFixture('playstore.html');
    const url = `${androidStoreURL}&hl=ja&gl=JP`;
    await checkVersion({ version: '1.0.0', androidStoreURL: url });
    const { url: requested, init } = requestOf(spy);
    expect(requested).toBe(url);
    expect(init?.headers).toBeUndefined();
  });

  it('validates the URL with the v1 pattern (http and the package charset)', async () => {
    mockFetchFixture('playstore.html');
    await expect(
      checkVersion({
        version: '1.0.0',
        androidStoreURL:
          'http://play.google.com/store/apps/details?id=com.github.android',
      })
    ).resolves.toMatchObject({ remote: '4.5.6' });
    await expect(
      checkVersion({
        version: '1.0.0',
        androidStoreURL: 'https://play.google.com/store/apps/details?id=_x',
      })
    ).rejects.toThrow(new Error('androidStoreURL is invalid.'));
  });
});

describe('auto detection of omitted arguments', () => {
  it('detects the version and the bundleId with expo-application (iOS)', async () => {
    setOptionalModules({ 'expo-application': expoApplication });
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await expect(checkVersion()).resolves.toEqual({
      local: '1.0.0',
      remote: '1.283.0',
      result: 'new',
      detail: 'remote > local',
    });
    const { url, init } = requestOf(spy);
    expect(url).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?bundleId=com\.example\.app&country=jp&\d+$/
    );
    expect(init?.headers).toEqual({ 'cache-control': 'no-cache' });
  });

  it('passes the given country to the bundleId lookup', async () => {
    setOptionalModules({ 'expo-application': expoApplication });
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await checkVersion({ country: 'us' });
    expect(requestOf(spy).url).toContain('&country=us&');
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
    await expect(checkVersion({})).resolves.toEqual({
      local: '1.283.0',
      remote: '1.283.0',
      result: 'equal',
      detail: 'remote === local',
    });
    expect(requestOf(spy).url).toBe(
      'https://play.google.com/store/apps/details?id=com.github.android'
    );
  });

  it('detects only the version when the store URL is given', async () => {
    setOptionalModules({ 'expo-application': expoApplication });
    const spy = mockFetchFixture('itunes-lookup.json');
    await expect(checkVersion({ iosStoreURL })).resolves.toMatchObject({
      local: '1.0.0',
      remote: '1.2.3',
    });
    expect(requestOf(spy).url).toContain('?id=1477376905&');
  });

  it('detects only the ID when the version is given', async () => {
    setPlatform('android');
    setOptionalModules({ 'expo-application': expoApplication });
    const spy = mockFetchFixture('playstore.html');
    await expect(checkVersion({ version: '4.5.6' })).resolves.toMatchObject({
      local: '4.5.6',
      remote: '4.5.6',
      result: 'equal',
    });
    expect(requestOf(spy).url).toBe(
      'https://play.google.com/store/apps/details?id=com.example.app'
    );
  });

  // v1 は falsy（空文字も）で throw していた。その条件のときだけ自動取得に回す
  it('treats empty strings as omitted', async () => {
    setOptionalModules({ 'expo-application': expoApplication });
    mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({ version: '', iosStoreURL: '' })
    ).resolves.toMatchObject({ local: '1.0.0', remote: '1.283.0' });
  });

  it('prefers the given values over the detected ones', async () => {
    setOptionalModules({ 'expo-application': expoApplication });
    mockFetchFixture('itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.2.3', iosStoreURL })
    ).resolves.toMatchObject({ local: '1.2.3', result: 'equal' });
  });

  // D48 ⑦: v2 の判定は Expo Go を skip するが、v1 互換の checkVersion は skip しない（v1 と同じく判定する）
  it('does not skip Expo Go', async () => {
    setOptionalModules({
      'expo-application': {
        nativeApplicationVersion: '2.0.0',
        applicationId: 'host.exp.Exponent',
      },
    });
    const spy = mockFetchFixture('store/itunes-lookup.json');
    await expect(checkVersion()).resolves.toMatchObject({ local: '2.0.0' });
    expect(requestOf(spy).url).toContain('bundleId=host.exp.Exponent&');
  });

  it('throws the compare-versions message when the detected version is invalid', async () => {
    setOptionalModules({
      'expo-application': {
        ...expoApplication,
        nativeApplicationVersion: 'abc',
      },
    });
    mockFetchFixture('store/itunes-lookup.json');
    await expect(checkVersion()).rejects.toThrow(
      new Error("Invalid argument not valid semver ('abc' received)")
    );
  });
});

describe('v1 messages when auto detection is not possible', () => {
  it.each(['ios', 'android'] as const)(
    '%s: local version is not set. (checked before the store URL)',
    async (os) => {
      setPlatform(os);
      await expect(checkVersion()).rejects.toThrow(
        new Error('local version is not set.')
      );
      await expect(
        checkVersion({ iosStoreURL, androidStoreURL })
      ).rejects.toThrow(new Error('local version is not set.'));
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it('ios: iosStoreURL is not set.', async () => {
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      new Error('iosStoreURL is not set.')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('android: androidStoreURL is not set.', async () => {
    setPlatform('android');
    await expect(checkVersion({ version: '1.0.0' })).rejects.toThrow(
      new Error('androidStoreURL is not set.')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('ios: iosStoreURL is not set. when only the version can be detected', async () => {
    setOptionalModules({
      'expo-application': { nativeApplicationVersion: '1.0.0' },
    });
    await expect(checkVersion()).rejects.toThrow(
      new Error('iosStoreURL is not set.')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('android: local version is not set. when only the ID can be detected', async () => {
    setPlatform('android');
    setOptionalModules({
      'react-native-device-info': { getBundleId: () => 'com.example.app' },
    });
    await expect(checkVersion()).rejects.toThrow(
      new Error('local version is not set.')
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// v1 は ios 以外をすべて Android の経路に進める（`androidStoreURL is not set.` は Platform.OS === 'android' のときだけ）
describe('Platform.OS other than ios / android', () => {
  it.each(['web', 'windows', 'macos'] as const)(
    '%s: goes through the Android path with androidStoreURL',
    async (os) => {
      setPlatform(os);
      const spy = mockFetchFixture('playstore.html');
      await expect(
        checkVersion({ version: '4.0.0', iosStoreURL, androidStoreURL })
      ).resolves.toEqual({
        local: '4.0.0',
        remote: '4.5.6',
        result: 'new',
        detail: 'remote > local',
      });
      expect(requestOf(spy).url).toBe(androidStoreURL);
    }
  );

  it.each(['web', 'windows', 'macos'] as const)(
    '%s: androidStoreURL is invalid. when it is omitted (no auto detection)',
    async (os) => {
      setPlatform(os);
      setOptionalModules({ 'expo-application': expoApplication });
      await expect(
        checkVersion({ version: '1.0.0', iosStoreURL })
      ).rejects.toThrow(new Error('androidStoreURL is invalid.'));
      await expect(
        checkVersion({ version: '1.0.0', androidStoreURL: '' })
      ).rejects.toThrow(new Error('androidStoreURL is invalid.'));
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it.each(['web', 'windows'] as const)(
    '%s: local version is not set. even when expo-application is installed (no auto detection)',
    async (os) => {
      setPlatform(os);
      setOptionalModules({ 'expo-application': expoApplication });
      await expect(checkVersion({ androidStoreURL })).rejects.toThrow(
        new Error('local version is not set.')
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['web', "can't get web version"],
    ['windows', "can't get windows version"],
  ] as const)(
    "%s: a non-Error failure becomes can't get <OS> version",
    async (os, message) => {
      setPlatform(os);
      mockFetchReject('offline');
      await expect(
        checkVersion({ version: '1.0.0', androidStoreURL })
      ).rejects.toThrow(new Error(message));
    }
  );

  it('web: other failures keep the Android messages', async () => {
    setPlatform('web');
    mockFetchResponse('', 404);
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).rejects.toThrow(new Error('androidStoreURL is invalid.'));
    mockFetchResponse('<html></html>');
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).rejects.toThrow(new Error("can't get android app version."));
  });
});

describe('timeoutMs', () => {
  const targets: [string, 'ios' | 'android', () => Promise<unknown>][] = [
    [
      'ios (iosStoreURL)',
      'ios',
      () => checkVersion({ version: '1.0.0', iosStoreURL, timeoutMs: 1000 }),
    ],
    [
      'ios (bundleId)',
      'ios',
      () => checkVersion({ version: '1.0.0', timeoutMs: 1000 }),
    ],
    [
      'android (androidStoreURL)',
      'android',
      () =>
        checkVersion({ version: '1.0.0', androidStoreURL, timeoutMs: 1000 }),
    ],
    [
      'android (package name)',
      'android',
      () => checkVersion({ version: '1.0.0', timeoutMs: 1000 }),
    ],
  ];

  it.each(targets)(
    '%s: throws StoreVersionError TIMEOUT and stops the fetch',
    async (_, os, run) => {
      setPlatform(os);
      setOptionalModules({ 'expo-application': expoApplication });
      jest.useFakeTimers();
      const { calls } = mockFetchPending();
      const error = catchError(run());
      await jest.advanceTimersByTimeAsync(999);
      expect(calls[0].aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const thrown = await error;
      expect(thrown).toBeInstanceOf(StoreVersionError);
      expect((thrown as StoreVersionError).code).toBe('TIMEOUT');
      expect(calls[0].aborted).toBe(true);
    }
  );

  it('does not time out when timeoutMs is omitted (same as v1)', async () => {
    jest.useFakeTimers();
    const { calls } = mockFetchPending();
    let settled = false;
    const promise = checkVersion({ version: '1.0.0', iosStoreURL }).finally(
      () => {
        settled = true;
      }
    );
    // タイマー自体を仕掛けない
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(settled).toBe(false);
    expect(calls[0].aborted).toBe(false);
    calls[0].respond({ json: { results: [{ version: '1.2.3' }] } });
    await expect(promise).resolves.toMatchObject({ remote: '1.2.3' });
  });

  it('resolves when the store responds before the timeout', async () => {
    setPlatform('android');
    jest.useFakeTimers();
    const { calls } = mockFetchPending();
    const promise = checkVersion({
      version: '1.0.0',
      androidStoreURL,
      timeoutMs: 1000,
    });
    await jest.advanceTimersByTimeAsync(500);
    calls[0].respond({ body: '[[["1.0.1"]],' });
    await expect(promise).resolves.toMatchObject({
      remote: '1.0.1',
      result: 'new',
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});

// v1 は呼び出しごとに fetch していた。v2 の request の層は同時の同じ取得を 1 回にまとめる（結果は同じ。キャッシュはしない）
describe('in-flight sharing of the request layer', () => {
  it('shares one fetch between concurrent calls and fetches again afterwards', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        createResponse({ json: { results: [{ version: '1.2.3' }] } })
      );
    const [a, b] = await Promise.all([
      checkVersion({ version: '1.0.0', iosStoreURL }),
      checkVersion({ version: '1.2.3', iosStoreURL }),
    ]);
    expect(a).toMatchObject({ result: 'new' });
    expect(b).toMatchObject({ result: 'equal' });
    expect(spy).toHaveBeenCalledTimes(1);
    await checkVersion({ version: '1.0.0', iosStoreURL });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
