import fetch from 'jest-fetch-mock';
import checkVersion from '../src';

describe('checkVersion', () => {
  beforeEach(() => {
    jest.mock('Platform', () => ({
      OS: 'android',
    }));
    jest.mock('fetch', fetch);
  });

  it('error pattern', async () => {
    const result = await checkVersion({
      version: '1.0.0',
    });

    console.log(result);

    expect(result).toHaveProperty('error', true);
  });

  it('correct pattern', async () => {
    const result = await checkVersion({
      version: '1.0.0',
      iosStoreURL: 'https://itunes.apple.com/app/id1321198947?mt=8',
      androidStoreURL: 'https://play.google.com/store/apps/details?id=jp.ewaf.pinpoint.android',
    });

    console.log(result);

    expect(result).toHaveProperty('error', false);
    expect(result).toHaveProperty('local');
    expect(result).toHaveProperty('remote');
    expect(result).toHaveProperty('result');
  });
});
