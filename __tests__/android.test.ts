import { getAndroidVersion } from '../src/android.ts';
import { mockFetchFixture, mockFetchResponse } from './__helpers__/fetch.ts';

const url = 'https://play.google.com/store/apps/details?id=com.github.android';

describe('getAndroidVersion', () => {
  it('extracts the version from the page', async () => {
    const spy = mockFetchFixture('playstore.html');
    await expect(getAndroidVersion(url)).resolves.toBe('4.5.6');
    expect(spy.mock.calls[0][0]).toBe(url);
  });

  it('throws when the url is invalid', async () => {
    const spy = mockFetchFixture('playstore.html');
    await expect(getAndroidVersion('https://example.com/')).rejects.toThrow(
      new Error('androidStoreURL is invalid.')
    );
    await expect(getAndroidVersion()).rejects.toThrow(
      new Error('androidStoreURL is invalid.')
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the response status is not 200', async () => {
    mockFetchResponse('not found', 404);
    await expect(getAndroidVersion(url)).rejects.toThrow(
      new Error('androidStoreURL is invalid.')
    );
  });

  it("throws when the version can't be found", async () => {
    mockFetchResponse('<html></html>');
    await expect(getAndroidVersion(url)).rejects.toThrow(
      new Error("can't get android app version.")
    );
  });
});
