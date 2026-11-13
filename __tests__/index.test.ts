import { compareVersion } from '../src/index.ts';

describe('compareVersion', () => {
  it('returns old when remote is older than local', () => {
    expect(compareVersion('1.1.0', '1.0.3')).toBe('old');
  });

  it('returns new when remote is newer than local', () => {
    expect(compareVersion('1.0.0', '1.1.0')).toBe('new');
  });

  it('returns equal when versions are the same', () => {
    expect(compareVersion('1.1.0', '1.1.0')).toBe('equal');
  });

  // v1（compare-versions 4.1.x（^4.1.3。現在の解決は 4.1.4））の実際の結果。compare-versions を取り込み直しても変わらないことを保証する
  it.each([
    ['1.0', '1.0.0', 'equal'],
    ['1.0.0', '1.0', 'equal'],
    ['1', '1.0.0', 'equal'],
    ['1.2.3', '1.2.3.1', 'new'],
    ['1.2.3.1', '1.2.3', 'old'],
    ['1.0.0.0', '1.0.0', 'equal'],
    ['1.0.0-beta', '1.0.0', 'new'],
    ['1.0.0', '1.0.0-beta', 'old'],
    ['1.0.0-alpha', '1.0.0-beta', 'new'],
    ['1.0.0-rc.1', '1.0.0-rc.2', 'new'],
    ['v1.0.0', '1.0.0', 'equal'],
    ['1.0.0', 'v1.0.0', 'equal'],
    ['1.0.0+build', '1.0.0', 'equal'],
    ['1.10.0', '1.9.0', 'old'],
    ['2024.01.15', '2024.1.16', 'new'],
    // 先頭ゼロを数値として比べていること（文字列比較なら '09' < '1' で new になる）
    ['2024.01.15', '2024.1.15', 'equal'],
    ['2024.09.01', '2024.1.1', 'old'],
  ])('compareVersion(%j, %j) returns %s', (local, remote, expected) => {
    expect(compareVersion(local, remote)).toBe(expected);
  });

  it.each([
    ['abc', '1.0.0', "Invalid argument not valid semver ('abc' received)"],
    ['1.0.0', 'abc', "Invalid argument not valid semver ('abc' received)"],
    ['', '1.0.0', "Invalid argument not valid semver ('' received)"],
    [
      '1.2.3.4.5',
      '1.0.0',
      "Invalid argument not valid semver ('1.2.3.4.5' received)",
    ],
  ])('compareVersion(%j, %j) throws', (local, remote, message) => {
    expect(() => compareVersion(local, remote)).toThrow(new Error(message));
  });
});
