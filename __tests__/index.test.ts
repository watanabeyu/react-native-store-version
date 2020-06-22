import checkVersion, { compareVersion } from '../src';
import getIOSVersion from '../src/ios';
import getAndroidVersion from '../src/android';

require('jest-fetch-mock');

describe('ios', () => {
  beforeEach(() => {
    jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
  });

  it('error pattern', async () => {
    const result = await checkVersion({
      version: '1.0.0',
    });

    expect(result).toHaveProperty('error', true);
  });

  it('get version', async () => {
    const correctPattern = await getIOSVersion('https://itunes.apple.com/jp/app/pin-point/id1321198947');
    expect(correctPattern).toEqual(expect.stringMatching(/[0-9]{1,}\.?[0-9]*\.?[0-9]*\.?/));

    try {
      await getIOSVersion('https://itunes.apple.com/jp/app/pin-point/id13211989471111');
    } catch (e) {
      expect(e).toHaveProperty('message');
    }

    try {
      await getIOSVersion();
    } catch (e) {
      expect(e).toHaveProperty('message');
    }
  });
});

describe('android', () => {
  beforeEach(() => {
    jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
  });

  it('error pattern', async () => {
    const result = await checkVersion({
      version: '1.0.0',
    });

    expect(result).toHaveProperty('error', true);
  });

  it('get version', async () => {
    const correctPattern = await getAndroidVersion('https://play.google.com/store/apps/details?id=jp.ewaf.likedsearch.android');
    expect(correctPattern).toEqual(expect.stringMatching(/[0-9]{1,}\.?[0-9]*\.?[0-9]*\.?/));

    try {
      await getAndroidVersion('https://play.google.com/store/apps/details?id=jp.ewaf.likedsearch.android1111');
    } catch (e) {
      expect(e).toHaveProperty('message');
    }

    try {
      await getAndroidVersion();
    } catch (e) {
      expect(e).toHaveProperty('message');
    }
  });
});

describe('other', () => {
  it('compare version', () => {
    const remoteIsOld = compareVersion('1.1.0', '1.0.3');
    expect(remoteIsOld).toBe('old');

    const remoteIsNew = compareVersion('1.0.0', '1.1.0');
    expect(remoteIsNew).toBe('new');

    const equal = compareVersion('1.1.0', '1.1.0');
    expect(equal).toBe('equal');
  });
});
