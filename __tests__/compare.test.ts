import { compareVersions as upstream } from 'compare-versions';

import {
  compareVersion,
  compareVersionStrict,
  diffType,
  toDetail,
} from '../src/compare.ts';
import { StoreVersionError } from '../src/errors.ts';
import { compareVersions as vendored } from '../src/vendor/compare-versions.ts';

// JSON の import は tsc（nodenext）が import attribute を要求するので、require で読む
const versions: string[] = require('./__fixtures__/versions.json');

describe('compareVersion', () => {
  it.each([
    ['1.0.0-alpha', '1.0.0-beta', 'new'],
    ['1.0.0-beta', '1.0.0', 'new'],
    ['1.0.0', '1.0.0-beta', 'old'],
    ['1.0', '1.0.0', 'equal'],
    ['1.2.3', '1.2.3.1', 'new'],
    ['1.2.3.4', '1.2.3.5', 'new'],
    ['2024.11.01', '2024.11.2', 'new'],
    ['v1.0.0', '1.0.0', 'equal'],
    // 4.1.x では new。6.1.1 の挙動を採用（D38 ③）
    ['1.0.0-alpha', '1.0.0-alpha.0', 'equal'],
  ])('compareVersion(%j, %j) returns %s', (local, remote, expected) => {
    expect(compareVersion(local, remote)).toBe(expected);
  });

  it.each([
    ['1.2.3.4.5', '1.0.0'],
    ['abc', '1.0.0'],
    ['1.0.0', 'Varies with device'],
  ])(
    'compareVersion(%j, %j) throws the compare-versions error as is',
    (a, b) => {
      const bad = [a, b].find((v) => v !== '1.0.0');
      expect(() => compareVersion(a, b)).toThrow(
        new Error(`Invalid argument not valid semver ('${bad}' received)`)
      );
    }
  );
});

describe('toDetail', () => {
  it.each([
    ['new', 'remote > local'],
    ['old', 'remote < local'],
    ['equal', 'remote === local'],
  ] as const)('%s -> %s', (result, detail) => {
    expect(toDetail(result)).toBe(detail);
  });
});

describe('diffType', () => {
  it.each([
    ['1.0.0', '2.0.0', 'major'],
    ['1.9.9', '2.0.0', 'major'],
    ['1.0.0', '1.1.0', 'minor'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.0.0', '1.0.1', 'patch'],
    ['1.2.3', '1.2.3.1', 'patch'],
    ['1.2.3.4', '1.2.3.5', 'patch'],
    ['1.2.3-beta', '1.2.3', 'patch'],
    ['1.0', '1.0.1', 'patch'],
    ['1', '1.1', 'minor'],
    ['1.0', '2', 'major'],
    ['v1.0.0', 'v1.1.0', 'minor'],
    ['2024.11.01', '2024.12.01', 'minor'],
    ['1.x.0', '1.0.1', 'patch'],
  ])('diffType(%j, %j) is %s', (local, remote, expected) => {
    expect(diffType(local, remote)).toBe(expected);
  });
});

describe('compareVersionStrict', () => {
  it('returns the same result as compareVersion', () => {
    expect(compareVersionStrict('1.0.0', '1.0.1')).toBe('new');
    expect(compareVersionStrict('1.0.1', '1.0.0')).toBe('old');
    expect(compareVersionStrict('1.0', '1.0.0')).toBe('equal');
  });

  it.each([
    ['abc', '1.0.0', 'local'],
    ['1.0.0', 'Varies with device', 'remote'],
    ['1.0.0', '1.2.3.4.5', 'remote'],
  ])('throws INVALID_VERSION for (%j, %j)', (a, b, label) => {
    let caught: unknown;
    try {
      compareVersionStrict(a, b);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StoreVersionError);
    const error = caught as StoreVersionError;
    expect(error.code).toBe('INVALID_VERSION');
    expect(error.message).toContain(label);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('uses the given labels in the message', () => {
    expect(() =>
      compareVersionStrict('1.0.0', 'x!', ['local', 'minimum'])
    ).toThrow(/minimum/);
  });
});

// 本家（devDependency の compare-versions 6.1.1）と取り込んだ vendor の結果が一致すること（D17）
const outcome = (
  fn: (a: string, b: string) => number,
  a: string,
  b: string
) => {
  try {
    return { value: fn(a, b) };
  } catch (e) {
    const error = e as Error;
    return { error: `${error.name}: ${error.message}` };
  }
};

describe('vendor/compare-versions matches upstream', () => {
  it('matches for all pairs of the fixture', () => {
    for (const a of versions) {
      for (const b of versions) {
        expect([a, b, outcome(vendored, a, b)]).toEqual([
          a,
          b,
          outcome(upstream, a, b),
        ]);
      }
    }
  });

  it('throws on non-strings with the same error', () => {
    for (const bad of [undefined, null, 1, {}]) {
      const args = [bad, '1.0.0'] as unknown as [string, string];
      expect(outcome(vendored, ...args)).toEqual(outcome(upstream, ...args));
    }
  });

  // シード固定の PRNG（mulberry32）。Math.random は使わない
  const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('matches for random pairs', () => {
    const rand = mulberry32(20261108);
    const int = (n: number) => Math.floor(rand() * n);
    const part = () => {
      const n = int(4) === 0 ? int(1000) : int(12);
      return rand() < 0.2 ? `0${n}` : String(n);
    };
    const pre = ['alpha', 'beta', 'rc.1', 'rc.2', 'alpha.0', '1', 'x-y'];
    const make = () => {
      let v = Array.from({ length: 1 + int(5) }, part).join('.');
      if (rand() < 0.3) v = `v${v}`;
      if (rand() < 0.3) v += `-${pre[int(pre.length)]}`;
      if (rand() < 0.1) v += '+build';
      return v;
    };
    for (let i = 0; i < 500; i++) {
      const a = make();
      const b =
        rand() < 0.3
          ? a.replace(/\d+$/, (m) => String(Number(m) + int(2)))
          : make();
      expect([a, b, outcome(vendored, a, b)]).toEqual([
        a,
        b,
        outcome(upstream, a, b),
      ]);
    }
  });
});
