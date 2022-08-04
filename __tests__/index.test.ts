import { compareVersion } from '../src';

describe('compare', () => {
  beforeEach(() => {
    jest.mock('react-native', () => ({ Platform: { os: 'ios' } }));
  });

  it('compare version', () => {
    const remoteIsOld = compareVersion('1.1.0', '1.0.3');
    expect(remoteIsOld).toBe('old');

    const remoteIsNew = compareVersion('1.0.0', '1.1.0');
    expect(remoteIsNew).toBe('new');

    const equal = compareVersion('1.1.0', '1.1.0');
    expect(equal).toBe('equal');
  });
});
