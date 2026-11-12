// v1 の checkVersion が、実ストアから取ってトリムした fixture（__fixtures__/store/）でも v1 どおりに動くことの確認。
// 手作りの fixture を使う index.test.ts（v1 の回帰テスト）はそのまま残す。fixture の出典は __fixtures__/store/README.md
import checkVersion from '../src/index.ts';
import { mockFetchFixture } from './__helpers__/fetch.ts';
import { setPlatform } from './__helpers__/platform.ts';

jest.mock(
  'react-native/Libraries/Utilities/Platform',
  () => require('./__helpers__/platform').platformModule
);

const iosStoreURL = 'https://apps.apple.com/jp/app/github/id1477376905';
const androidStoreURL =
  'https://play.google.com/store/apps/details?id=com.github.android';

describe('checkVersion with real store fixtures (ios)', () => {
  beforeEach(() => {
    setPlatform('ios');
  });

  it('reads results[0].version from the real lookup response', async () => {
    mockFetchFixture('store/itunes-lookup.json');
    await expect(
      checkVersion({ version: '1.282.0', iosStoreURL })
    ).resolves.toEqual({
      local: '1.282.0',
      remote: '1.283.0',
      result: 'new',
      detail: 'remote > local',
    });
  });

  it('throws when the real lookup response is empty', async () => {
    mockFetchFixture('store/itunes-lookup-empty.json');
    await expect(
      checkVersion({ version: '1.0.0', iosStoreURL })
    ).rejects.toThrow(new Error('appID(1477376905) is not released.'));
  });
});

describe('checkVersion with real store fixtures (android)', () => {
  beforeEach(() => {
    setPlatform('android');
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

  // v1 は数字とドットだけの版しか取れない。changed（構造の変更）/ varies（版の位置が空）/ nonnumeric（独自形式の版）は
  // どれも v1 では抽出できず、同じメッセージで throw する
  it.each([
    'store/playstore-changed.html',
    'store/playstore-varies.html',
    'store/playstore-nonnumeric.html',
  ])("throws can't get android app version. for %s", async (name) => {
    mockFetchFixture(name);
    await expect(
      checkVersion({ version: '1.0.0', androidStoreURL })
    ).rejects.toThrow(new Error("can't get android app version."));
  });
});
