import fetch from 'jest-fetch-mock';
import checkVersion from '../src';
import checkIOS from '../src/ios';
import checkAndroid from '../src/android';

describe('checkVersion', () => {
  beforeEach(() => {
    jest.mock('Platform', () => ({ OS: 'android' }));
    jest.mock('fetch', fetch);
    jest.setTimeout(30000);
  });

  it('error pattern', async () => {
    const result = await checkVersion({
      version: '1.0.0',
    });

    console.log(result);

    expect(result).toHaveProperty('error', true);
  });

  it('ios correct pattern 1', async () => {
    const result = await checkIOS(
      '1.0.0',
      'https://itunes.apple.com/app/id1321198947?mt=8',
      'us',
    );

    console.log(result);

    expect(result).toHaveProperty('local');
    expect(result).toHaveProperty('remote');
    expect(result).toHaveProperty('result', 'new');
  });

  it('ios correct pattern 2', async () => {
    const result = await checkIOS(
      '1.0.0',
      'https://itunes.apple.com/jp/app/pin-point/id1321198947',
    );

    console.log(result);

    expect(result).toHaveProperty('local');
    expect(result).toHaveProperty('remote');
    expect(result).toHaveProperty('result', 'new');
  });

  it('android correct pattern', async () => {
    const result = await checkAndroid(
      '10.0.0',
      'https://play.google.com/store/apps/details?id=jp.ewaf.likedsearch.android',
    );

    console.log(result);

    expect(result).toHaveProperty('local');
    expect(result).toHaveProperty('remote');
    expect(result).toHaveProperty('result', 'old');
  });
});
