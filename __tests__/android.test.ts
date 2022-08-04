import { getAndroidVersion } from '../src/android';

jest.mock('node-fetch');

describe('android', () => {
  beforeEach(() => {
    jest.mock('react-native', () => ({ Platform: { os: 'android' } }));
    jest.mock('react-native', () => ({ Platform: { os: 'android' } }));
  });

  it('get version', async () => {
    try {
      await getAndroidVersion(
        'https://play.google.com/store/apps/details?id=com.github.android'
      );
    } catch (e) {
      expect(e).toHaveProperty('message');
    }
  });
});
