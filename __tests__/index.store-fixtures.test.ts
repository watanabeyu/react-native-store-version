// checkVersion（パッケージの入口から読む）が、実ストアから取ってトリムした fixture（__fixtures__/store/）で期待どおりに動くことの確認。
// fixture の出典は __fixtures__/store/README.md
import { checkVersion } from '../src/index.ts';
import { mockFetchFixture } from './__helpers__/fetch.ts';
import { setOptionalModules } from './__helpers__/modules.ts';
import { setPlatform } from './__helpers__/platform.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

const bundleId = 'com.github.stormbreaker.prod';
const packageName = 'com.github.android';

describe('checkVersion with real store fixtures (ios)', () => {
  beforeEach(() => {
    setPlatform('ios');
    // optional peer は入っていない状態に固定する（明示した値だけで確かめる）
    setOptionalModules();
  });

  it('reads results[0] of the real lookup response', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.282.0', bundleId, country: 'jp' })
    ).resolves.toEqual({
      status: 'ready',
      local: '1.282.0',
      remote: '1.283.0',
      result: 'new',
      detail: 'remote > local',
      diff: 'minor',
      minimum: null,
      belowMinimum: false,
      releaseNotes: "What's new\n\n…",
      releaseDate: '2026-11-05T14:25:25Z',
    });
  });

  it('rejects with NOT_FOUND when the real lookup response is empty', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    await expect(
      checkVersion({ version: '1.0.0', bundleId, country: 'jp' })
    ).rejects.toMatchObject({ name: 'StoreVersionError', code: 'NOT_FOUND' });
  });
});

describe('checkVersion with real store fixtures (android)', () => {
  beforeEach(() => {
    setPlatform('android');
    setOptionalModules();
  });

  it('extracts the version, release notes and release date from the real page', async () => {
    mockFetchFixture('store/playstore.html');
    await expect(
      checkVersion({ version: '1.283.0', packageName })
    ).resolves.toEqual({
      status: 'ready',
      local: '1.283.0',
      remote: '1.283.0',
      result: 'equal',
      detail: 'remote === local',
      diff: null,
      minimum: null,
      belowMinimum: false,
      releaseNotes:
        'Meet the redesigned Copilot in GitHub Mobile!\n\n- Chat and code in one Copilot tab.\n- Run secure, isolated cloud sessions and resume later - no computer needed.',
      releaseDate: '2026-11-05T22:49:03Z',
    });
  });

  // changed（構造の変更）は抽出できない。varies（版の位置が空）/ nonnumeric（独自形式の版）は比較できない
  it.each([
    ['store/playstore-changed.html', 'PARSE_FAILED'],
    ['store/playstore-varies.html', 'INVALID_VERSION'],
    ['store/playstore-nonnumeric.html', 'INVALID_VERSION'],
  ])('rejects %s with %s', async (name, code) => {
    mockFetchFixture(name);
    await expect(
      checkVersion({ version: '1.0.0', packageName })
    ).rejects.toMatchObject({ name: 'StoreVersionError', code });
  });
});
