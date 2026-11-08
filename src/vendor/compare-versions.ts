/*!
 * compare-versions 6.1.1 (https://github.com/omichelsen/compare-versions)
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2015-2021 Ole Michelsen
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// 取り込んだ版: compare-versions 6.1.1（下の VENDORED_VERSION と揃える。差分テストが devDependency の版と照合する）
// 取り込んだ関数: compareVersions（src/compareVersions.ts）、validateAndParse / compareSegments（src/utils.ts）、
//   validate（src/validate.ts）。`satisfies` / `compare` / `validateStrict` は使わないので取り込まない
// 本家からの変更点（更新時の差分確認用）:
//   1. 本家の compareVersions.ts / utils.ts / validate.ts を 1 ファイルにまとめた（import の `./utils.js` を削除）
//   2. 不要な型 `CompareOperator` と `validateStrict` を削除
//   3. 取り込んだ版を示す定数 VENDORED_VERSION を追加
//   4. 上記以外のロジック・正規表現・エラーメッセージは本家のまま（Biome の lint / 整形の対象外）

export const VENDORED_VERSION = '6.1.1';

export const semver =
  /^[v^~<>=]*?(\d+)(?:\.([x*]|\d+)(?:\.([x*]|\d+)(?:\.([x*]|\d+))?(?:-([\da-z\-]+(?:\.[\da-z\-]+)*))?(?:\+[\da-z\-]+(?:\.[\da-z\-]+)*)?)?)?$/i;

export const validateAndParse = (version: string) => {
  if (typeof version !== 'string') {
    throw new TypeError('Invalid argument expected string');
  }
  const match = version.match(semver);
  if (!match) {
    throw new Error(
      `Invalid argument not valid semver ('${version}' received)`
    );
  }
  match.shift();
  return match;
};

const isWildcard = (s: string) => s === '*' || s === 'x' || s === 'X';

const tryParse = (v: string) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? v : n;
};

const forceType = (a: string | number, b: string | number) =>
  typeof a !== typeof b ? [String(a), String(b)] : [a, b];

const compareStrings = (a: string, b: string) => {
  if (isWildcard(a) || isWildcard(b)) return 0;
  const [ap, bp] = forceType(tryParse(a), tryParse(b));
  if (ap > bp) return 1;
  if (ap < bp) return -1;
  return 0;
};

export const compareSegments = (
  a: string | string[] | RegExpMatchArray,
  b: string | string[] | RegExpMatchArray
) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const r = compareStrings(a[i] || '0', b[i] || '0');
    if (r !== 0) return r;
  }
  return 0;
};

/**
 * Compare [semver](https://semver.org/) version strings to find greater, equal or lesser.
 * This library supports the full semver specification, including comparing versions with different number of digits like `1.0.0`, `1.0`, `1`, and pre-release versions like `1.0.0-alpha`.
 * @param v1 - First version to compare
 * @param v2 - Second version to compare
 * @returns Numeric value compatible with the [Array.sort(fn) interface](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#Parameters).
 */
export const compareVersions = (v1: string, v2: string) => {
  // validate input and split into segments
  const n1 = validateAndParse(v1);
  const n2 = validateAndParse(v2);

  // pop off the patch
  const p1 = n1.pop();
  const p2 = n2.pop();

  // validate numbers
  const r = compareSegments(n1, n2);
  if (r !== 0) return r;

  // validate pre-release
  if (p1 && p2) {
    return compareSegments(p1.split('.'), p2.split('.'));
  } else if (p1 || p2) {
    return p1 ? -1 : 1;
  }

  return 0;
};

/**
 * Validate [semver](https://semver.org/) version strings.
 *
 * @param version Version number to validate
 * @returns `true` if the version number is a valid semver version number, `false` otherwise.
 *
 * @example
 * ```
 * validate('1.0.0-rc.1'); // return true
 * validate('1.0-rc.1'); // return false
 * validate('foo'); // return false
 * ```
 */
export const validate = (version: string) =>
  typeof version === 'string' && /^[v\d]/.test(version) && semver.test(version);
