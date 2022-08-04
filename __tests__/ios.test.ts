import { getIOSVersion } from '../src/ios';

require('jest-fetch-mock');

describe('ios', () => {
  beforeEach(() => {
    jest.mock('react-native', () => ({ Platform: { os: 'ios' } }));
  });

  it('get version', async () => {
    try {
      await getIOSVersion('https://apps.apple.com/jp/app/github/id1477376905');
    } catch (e) {
      expect(e).toHaveProperty('message');
    }
  });
});
