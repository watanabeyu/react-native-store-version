import { getIOSVersion } from '../src/ios.ts';
import { mockFetchFixture } from './__helpers__/fetch.ts';

describe('getIOSVersion', () => {
  it('returns the version of the first result', async () => {
    mockFetchFixture('itunes-lookup.json');
    await expect(
      getIOSVersion('https://apps.apple.com/jp/app/github/id1477376905')
    ).resolves.toBe('1.2.3');
  });

  it('defaults country to jp and sends no-cache', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await getIOSVersion('https://apps.apple.com/jp/app/github/id1477376905');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toMatch(
      /^https:\/\/itunes\.apple\.com\/lookup\?id=1477376905&country=jp&\d+$/
    );
    expect(init).toEqual({ headers: { 'cache-control': 'no-cache' } });
  });

  it('uses the given country', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await getIOSVersion(
      'https://apps.apple.com/us/app/github/id1477376905',
      'us'
    );
    expect(String(spy.mock.calls[0][0])).toContain('country=us');
  });

  it('throws when the url is invalid', async () => {
    const spy = mockFetchFixture('itunes-lookup.json');
    await expect(getIOSVersion('https://example.com/')).rejects.toThrow(
      new Error('iosStoreURL is invalid.')
    );
    await expect(getIOSVersion()).rejects.toThrow(
      new Error('iosStoreURL is invalid.')
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the app is not released', async () => {
    mockFetchFixture('itunes-lookup-empty.json');
    await expect(
      getIOSVersion('https://apps.apple.com/jp/app/github/id1477376905')
    ).rejects.toThrow(new Error('appID(1477376905) is not released.'));
  });
});
