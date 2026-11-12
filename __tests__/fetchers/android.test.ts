import { StoreVersionError } from '../../src/errors.ts';
import {
  extractPlayRelease,
  extractPlayVersion,
  fetchAndroidVersion,
  PLAY_VERSION_PATTERNS,
  playExtrasOf,
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

// store/README.md の Expected result（リリースノートは `<br>` を `\n` に直したもの）
const GITHUB_NOTES =
  'Meet the redesigned Copilot in GitHub Mobile!\n\n- Chat and code in one Copilot tab.\n- Run secure, isolated cloud sessions and resume later - no computer needed.';
const GITHUB_DATE = '2026-11-05T22:49:03Z';
const MAPS_NOTES =
  'Thanks for using Google Maps! This release brings bug fixes that improve our product to help you discover new places and navigate to them.\n\nBecome a beta tester: …';
const MAPS_DATE = '2026-11-11T15:35:50Z';
const CALCULATOR_NOTES =
  '• Updated to Material 3 Expressive design\n• Bug fixes';
const CALCULATOR_DATE = '2026-09-16T07:25:27Z';
const GMS_DATE = '2026-11-12T01:53:36Z';
const WIKIPEDIA_NOTES =
  'Beta testing Semantic Search in Arabic, French and Japanese';
const WIKIPEDIA_DATE = '2026-11-05T18:31:59Z';

// playstore.html のリリースノートの位置（HTML の中では `<` が `\u003c` とエスケープされている）
const GITHUB_NOTES_SLOT =
  '[null,[null,"Meet the redesigned Copilot in GitHub Mobile!\\u003cbr\\u003e\\u003cbr\\u003e- Chat and code in one Copilot tab.\\u003cbr\\u003e- Run secure, isolated cloud sessions and resume later - no computer needed."]]';

/** playstore.html のリリースノートの位置を置き換えた入力（置き換える場所が無ければ throw してテストを止める） */
const withNotesSlot = (replacement: string): string => {
  const html = readFixture('store/playstore.html');
  if (!html.includes(GITHUB_NOTES_SLOT)) {
    throw new Error('the release notes slot is not in playstore.html');
  }
  return html.replace(GITHUB_NOTES_SLOT, replacement);
};

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
  it('builds the URL from the package name without any query and extracts the version, release notes and release date (real page)', async () => {
    const spy = mockFetchFixture('store/playstore.html');
    await expect(fetchAndroidVersion({ packageName })).resolves.toEqual({
      version: '1.283.0',
      storeUrl:
        'https://play.google.com/store/apps/details?id=com.github.android',
      releaseNotes: GITHUB_NOTES,
      releaseDate: GITHUB_DATE,
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
      releaseNotes: GITHUB_NOTES,
      releaseDate: GITHUB_DATE,
    });
    expect(requestOf(spy).url).toBe(storeUrl);
  });

  it('throws NOT_FOUND on status 404 (the app is not on Google Play)', async () => {
    mockFetchResponse('<html>not found</html>', 404);
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe(
      `the app (packageName "${packageName}") is not found on Google Play`
    );
  });

  it('throws NOT_FOUND with the URL on status 404 for a store URL', async () => {
    mockFetchResponse('<html>not found</html>', 404);
    const storeUrl = 'https://play.google.com/store/apps/details?id=x.y';
    const error = await catchError(fetchAndroidVersion({ storeUrl }));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe(
      `the app (${storeUrl}) is not found on Google Play`
    );
  });

  it('throws NOT_FOUND on status 404 even when reading the body fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 404,
      text: async () => {
        throw new TypeError('body stream failed');
      },
    } as unknown as Response);
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('keeps NETWORK when reading the body fails on status 200', async () => {
    const cause = new TypeError('body stream failed');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      text: async () => {
        throw cause;
      },
    } as unknown as Response);
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('NETWORK');
    expect(error.cause).toBe(cause);
  });

  it.each([500, 302, 403])('throws NETWORK on status %d', async (status) => {
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

  it('throws PARSE_FAILED for a changed page and attaches nothing (real fixture)', async () => {
    mockFetchFixture('store/playstore-changed.html');
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('PARSE_FAILED');
    expect(playExtrasOf(error)).toEqual({});
  });

  it('returns the version without releaseNotes when the release notes are null (version present)', async () => {
    mockFetchResponse(withNotesSlot('null'));
    const result = await fetchAndroidVersion({ packageName });
    expect(result).toEqual({
      version: '1.283.0',
      storeUrl:
        'https://play.google.com/store/apps/details?id=com.github.android',
      releaseDate: GITHUB_DATE,
    });
    expect('releaseNotes' in result).toBe(false);
  });

  it('returns the version without either value when the page has no release block (decoy only)', async () => {
    mockFetchResponse('[[["4.5.6"]],yy');
    const result = await fetchAndroidVersion({ packageName });
    expect(result).toEqual({
      version: '4.5.6',
      storeUrl:
        'https://play.google.com/store/apps/details?id=com.github.android',
    });
  });

  it('throws INVALID_VERSION when the version slot is empty (Varies with device, real fixture)', async () => {
    mockFetchFixture('store/playstore-varies.html');
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('INVALID_VERSION');
    expect(error.message).toContain('Varies with device');
  });

  it.each([
    [
      'store/playstore-varies.html',
      { releaseNotes: MAPS_NOTES, releaseDate: MAPS_DATE },
    ],
    [
      'store/playstore-varies-nosdk.html',
      { releaseNotes: CALCULATOR_NOTES, releaseDate: CALCULATOR_DATE },
    ],
    ['store/playstore-no-notes.html', { releaseDate: GMS_DATE }],
    [
      'store/playstore-nonnumeric.html',
      { releaseNotes: WIKIPEDIA_NOTES, releaseDate: WIKIPEDIA_DATE },
    ],
  ])(
    '%s: attaches the release notes and date to the INVALID_VERSION it throws',
    async (name, expected) => {
      mockFetchFixture(name);
      const error = await catchError(fetchAndroidVersion({ packageName }));
      expect(error).toBeInstanceOf(StoreVersionError);
      expect(error.code).toBe('INVALID_VERSION');
      expect(playExtrasOf(error)).toEqual(expected);
      // nothing is added to the error object itself
      expect(Object.keys(error)).not.toContain('releaseNotes');
      expect(Object.keys(error)).not.toContain('releaseDate');
    }
  );

  it('does not attach the release block to PARSE_FAILED even when the block matches', async () => {
    // an empty version slot at the very start: the Varies check needs `,null,null,null,` before it and the v1 pattern
    // needs a version, so no pattern finds a version, while the release block after the slot still matches
    const html =
      '[[null,[]],[[[36]],[null,[]]]],null,null,null,null,[["Nov 6, 2026",[1793918943,293000000]]]';
    expect(extractPlayRelease(html)).toEqual({ releaseDate: GITHUB_DATE });
    mockFetchResponse(html);
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('PARSE_FAILED');
    expect(playExtrasOf(error)).toEqual({});
  });

  it.each([
    ['NOT_FOUND', 404],
    ['NETWORK', 500],
  ])('does not attach the release block to %s', async (code, status) => {
    mockFetchFixture('store/playstore-varies.html', status);
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe(code);
    expect(playExtrasOf(error)).toEqual({});
  });

  it('throws INVALID_VERSION when the version slot is empty and has no minimum OS label (Varies with device, real fixture)', async () => {
    // the shape this test is about: no version and no minimum OS label
    expect(readFixture('store/playstore-varies-nosdk.html')).toContain(
      '[[null,[]],[[[36]],[null,[]]]]'
    );
    mockFetchFixture('store/playstore-varies-nosdk.html');
    const error = await catchError(fetchAndroidVersion({ packageName }));
    expect(error.code).toBe('INVALID_VERSION');
    expect(error.message).toContain('Varies with device');
  });

  it('still throws INVALID_VERSION for a Varies page whose release notes are null (real fixture)', async () => {
    // the shape this test is about: an empty version slot followed by `null` instead of the release notes
    expect(readFixture('store/playstore-no-notes.html')).toContain(
      '[[null,[]],[[[18,"4.3"]],[null,[]]]],null,null,null,null,[["'
    );
    mockFetchFixture('store/playstore-no-notes.html');
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

  it('treats a slightly different empty slot (another minimum OS block) as Varies, not the decoy from the v1 pattern', () => {
    const html =
      '[[["1.0.0"]],decoy,null,null,null,[[null,[]],[[[30,"11"]],[[[31,"12"]]]]],null,';
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

describe('extractPlayRelease', () => {
  it.each([
    [
      'store/playstore.html',
      { releaseNotes: GITHUB_NOTES, releaseDate: GITHUB_DATE },
    ],
    ['store/playstore-changed.html', {}],
    [
      'store/playstore-varies.html',
      { releaseNotes: MAPS_NOTES, releaseDate: MAPS_DATE },
    ],
    [
      'store/playstore-varies-nosdk.html',
      { releaseNotes: CALCULATOR_NOTES, releaseDate: CALCULATOR_DATE },
    ],
    ['store/playstore-no-notes.html', { releaseDate: GMS_DATE }],
    [
      'store/playstore-nonnumeric.html',
      { releaseNotes: WIKIPEDIA_NOTES, releaseDate: WIKIPEDIA_DATE },
    ],
  ])('%s -> %p', (name, expected) => {
    expect(extractPlayRelease(readFixture(name))).toEqual(expected);
  });

  it('turns <br>, <br/> and <br /> into line breaks and keeps the other tags and entities', () => {
    const notes = JSON.stringify(
      'a<br>b<br/>c<br />d<b>bold</b> &amp; &lt;e&gt;'
    );
    expect(extractPlayRelease(withNotesSlot(`[null,[null,${notes}]]`))).toEqual(
      {
        releaseNotes: 'a\nb\nc\nd<b>bold</b> &amp; &lt;e&gt;',
        releaseDate: GITHUB_DATE,
      }
    );
  });

  it.each([
    // version present, but the minimum OS part is empty
    '[[["1.2.3"]],[[[37]],[null,[]]]],null,null,null,[null,[null,"notes"]],[["Nov 6, 2026",[1793918943,0]]]',
    // version present, with a minimum OS label in the SDK part
    '[[["1.2.3"]],[[[37,"8.0"]],[[[26,"8.0"]]]]],null,null,null,[null,[null,"notes"]],[["Nov 6, 2026",[1793918943,0]]]',
  ])(
    'reads nothing after a version slot that is not one of the three known shapes: %s',
    (html) => {
      expect(extractPlayRelease(html)).toEqual({});
    }
  );

  it('does not throw when running the pattern throws (an engine limit, for example)', () => {
    const html = {
      match: () => {
        throw new RangeError('Maximum regex stack depth reached');
      },
    } as unknown as string;
    expect(extractPlayRelease(html)).toEqual({});
  });

  it('leaves releaseNotes undefined when the release notes are empty', () => {
    expect(extractPlayRelease(withNotesSlot('[null,[null,""]]'))).toEqual({
      releaseDate: GITHUB_DATE,
    });
  });

  it('leaves releaseNotes undefined (without throwing) when the string is not valid JSON', () => {
    // `\x` is not a JSON escape
    expect(
      extractPlayRelease(withNotesSlot('[null,[null,"bad \\x escape"]]'))
    ).toEqual({ releaseDate: GITHUB_DATE });
  });

  it('leaves releaseDate undefined (without throwing) when the seconds are out of range', () => {
    const html = readFixture('store/playstore.html').replace(
      '[1793918943,293000000]',
      '[99999999999999999,0]'
    );
    expect(html).toContain('[99999999999999999,0]');
    expect(extractPlayRelease(html)).toEqual({ releaseNotes: GITHUB_NOTES });
  });

  it('reads the block right after each of the three version slot shapes', () => {
    const tail =
      ',null,null,null,[null,[null,"n"]],[["d",[1793918943,293000000]]]';
    for (const slot of [
      '[[["1.0.0"]],[[[37]],[[[26,"8.0"]]]]]',
      '[[null,[]],[[[28,"9"]],[null,[]]]]',
      '[[null,[]],[[[36]],[null,[]]]]',
    ]) {
      expect(extractPlayRelease(`x${slot}${tail}`)).toEqual({
        releaseNotes: 'n',
        releaseDate: GITHUB_DATE,
      });
    }
  });

  it('does not read a date-shaped array that is not right after the version slot', () => {
    expect(
      extractPlayRelease(
        '[[["1.0.0"]],[[[37]],[[[26,"8.0"]]]]],null,null,null,null,"x",[["d",[1793918943,293000000]]]'
      )
    ).toEqual({});
  });
});

describe('playExtrasOf', () => {
  it.each([
    ['an error without anything attached', new Error('x')],
    ['a non-object', 'x'],
    ['null', null],
    ['undefined', undefined],
  ])('returns an empty object for %s', (_, value) => {
    expect(playExtrasOf(value)).toEqual({});
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

// 実ページの fixture に、どのパターンが当たるか（store/README.md の Expected result）
describe('PLAY_VERSION_PATTERNS against the real pages', () => {
  it.each([
    ['store/playstore.html', '1.283.0', false],
    ['store/playstore-changed.html', undefined, false],
    ['store/playstore-varies.html', undefined, true],
    ['store/playstore-varies-nosdk.html', undefined, true],
    ['store/playstore-no-notes.html', undefined, true],
    ['store/playstore-nonnumeric.html', '50616-r-2026-11-03', false],
  ])('%s: version slot %p, empty slot %p', (name, slot, empty) => {
    const html = readFixture(name);
    expect(html.match(PLAY_VERSION_PATTERNS.versionSlot)?.[1]).toBe(slot);
    expect(PLAY_VERSION_PATTERNS.emptyVersionSlot.test(html)).toBe(empty);
  });

  it.each([
    ['store/playstore.html', 1],
    ['store/playstore-changed.html', 0],
    ['store/playstore-varies.html', 1],
    ['store/playstore-varies-nosdk.html', 1],
    ['store/playstore-no-notes.html', 1],
    ['store/playstore-nonnumeric.html', 1],
  ])('%s: the release block matches %d time(s)', (name, count) => {
    const html = readFixture(name);
    const all = new RegExp(PLAY_VERSION_PATTERNS.release.source, 'g');
    expect(html.match(all)?.length ?? 0).toBe(count);
  });

  it.each([
    ['store/playstore.html', '1.283.0'],
    ['store/playstore-changed.html', 'PARSE_FAILED'],
    ['store/playstore-varies.html', 'INVALID_VERSION'],
    ['store/playstore-varies-nosdk.html', 'INVALID_VERSION'],
    ['store/playstore-no-notes.html', 'INVALID_VERSION'],
    ['store/playstore-nonnumeric.html', 'INVALID_VERSION'],
  ])('%s -> %s', (name, expected) => {
    const html = readFixture(name);
    let actual: string;
    try {
      actual = extractPlayVersion(html);
    } catch (error) {
      actual = (error as StoreVersionError).code;
    }
    expect(actual).toBe(expected);
  });
});
