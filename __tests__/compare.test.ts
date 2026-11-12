import {
  compareVersions as upstream,
  validate as upstreamValidate,
} from 'compare-versions';

import {
  compareVersion,
  compareVersionOrThrow,
  diffType,
  toDetail,
} from '../src/compare.ts';
import { StoreVersionError } from '../src/errors.ts';
import {
  VENDORED_VERSION,
  compareVersions as vendored,
  validate as vendoredValidate,
} from '../src/vendor/compare-versions.ts';

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
    // 以下は 4.1.x と 6.1.1 で結果が変わる入力。6.1.1 の値で固定する
    ['1.0.0-alpha', '1.0.0-alpha.0', 'equal'],
    ['>=1.0.0', '2.0.0', 'new'],
    ['^1.0.0', '2.0.0', 'new'],
    ['V1.0.0', '2.0.0', 'new'],
    ['1.2.3.4-beta', '1.2.3.4', 'new'],
    // v2 の判定でも有効な値として比べられる（ワイルドカードと範囲の記号）
    ['1.x.5', '1.0.5', 'equal'],
    ['1.*.0', '1.5.0', 'equal'],
    ['~1.2.3', '1.2.4', 'new'],
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

describe('compareVersionOrThrow', () => {
  it('returns the same result as compareVersion', () => {
    expect(compareVersionOrThrow('1.0.0', '1.0.1')).toBe('new');
    expect(compareVersionOrThrow('1.0.1', '1.0.0')).toBe('old');
    expect(compareVersionOrThrow('1.0', '1.0.0')).toBe('equal');
  });

  it.each([
    ['abc', '1.0.0', 'local'],
    ['1.0.0', 'Varies with device', 'remote'],
    ['1.0.0', '1.2.3.4.5', 'remote'],
  ])('throws INVALID_VERSION for (%j, %j)', (a, b, label) => {
    let caught: unknown;
    try {
      compareVersionOrThrow(a, b);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StoreVersionError);
    const error = caught as StoreVersionError;
    expect(error.code).toBe('INVALID_VERSION');
    expect(error.message).toContain(label);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('builds the message without throwing for any value', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const value of [10n, circular, Symbol('x'), null, undefined, 1]) {
      const error = (() => {
        try {
          compareVersionOrThrow(value as unknown as string, '1.0.0');
        } catch (e) {
          return e as StoreVersionError;
        }
      })();
      expect(error).toBeInstanceOf(StoreVersionError);
      expect(error?.code).toBe('INVALID_VERSION');
      expect(error?.message).toContain(`(${typeof value})`);
    }
  });

  it('uses the given labels in the message', () => {
    expect(() =>
      compareVersionOrThrow('1.0.0', 'x!', ['local', 'minimum'])
    ).toThrow(/minimum/);
  });
});

// 本家（devDependency の compare-versions）と取り込んだ vendor の結果が一致すること
const outcome = <T>(fn: (a: string, b: string) => T, a: string, b: string) => {
  try {
    return { value: fn(a, b) };
  } catch (e) {
    const error = e as Error;
    return { error: `${error.name}: ${error.message}` };
  }
};

describe('vendor/compare-versions matches upstream', () => {
  // devDependency の版と取り込んだ版が違うと必ず赤にする。本家が上がった（Dependabot の PR）ときに、
  // 取り込み直すかどうかを人が判断するため（取り込み直したら VENDORED_VERSION と先頭コメントの版を上げる）
  it('vendors the same version as the devDependency', () => {
    const { version } = require('compare-versions/package.json');
    expect(VENDORED_VERSION).toBe(version);
  });

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

  it('matches validate for the fixture and non-strings', () => {
    for (const v of [...versions, undefined, null, 1, {}] as string[]) {
      expect([v, vendoredValidate(v)]).toEqual([v, upstreamValidate(v)]);
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
    const pick = <T>(list: T[]) => list[int(list.length)];
    const number = () => {
      const n = int(4) === 0 ? int(1000) : int(12);
      return rand() < 0.2 ? `0${n}` : String(n);
    };
    const segment = () => (rand() < 0.1 ? pick(['x', 'X', '*']) : number());
    const preItem = () =>
      pick([
        'alpha',
        'beta',
        'rc',
        'RC',
        'Beta',
        'x',
        'a-b',
        '0',
        '1',
        '12',
        '007',
        'z9',
      ]);
    // 5 桁は 5% 程度（throw するペアばかりにしない）
    const digits = () => {
      const r = rand();
      return r < 0.05 ? 5 : r < 0.2 ? 1 : r < 0.4 ? 2 : r < 0.7 ? 3 : 4;
    };
    const parts = () => {
      const n = digits();
      return Array.from({ length: n }, (_, i) =>
        i === 0 ? number() : segment()
      );
    };
    const prefix = () =>
      rand() < 0.4 ? pick(['v', 'V', '^', '~', '>=', '<', '=', 'v^']) : '';
    const pre = () => Array.from({ length: 1 + int(3) }, preItem).join('.');
    const make = (core: string[], preRelease: string | null) =>
      `${prefix()}${core.join('.')}${preRelease ? `-${preRelease}` : ''}${rand() < 0.1 ? '+build.1' : ''}`;

    let valid = 0;
    for (let i = 0; i < 1500; i++) {
      const core = parts();
      const a = make(core, rand() < 0.5 ? pre() : null);
      let b: string;
      const mode = int(3);
      if (mode === 0) {
        // 数字の部分は a と同じで、プレリリースだけ違う
        b = make(core, rand() < 0.8 ? pre() : null);
      } else if (mode === 1) {
        // 最後の桁だけ違う
        b = make(
          core.map((c, i) =>
            i === core.length - 1 && /^\d+$/.test(c)
              ? String(Number(c) + int(2))
              : c
          ),
          rand() < 0.5 ? pre() : null
        );
      } else {
        b = make(parts(), rand() < 0.5 ? pre() : null);
      }
      const expected = outcome(upstream, a, b);
      if ('value' in expected) valid++;
      expect([a, b, outcome(vendored, a, b)]).toEqual([a, b, expected]);
      expect([a, vendoredValidate(a)]).toEqual([a, upstreamValidate(a)]);
    }
    // throw するペアばかりになっていないこと
    expect(valid).toBeGreaterThan(800);
  });
});
