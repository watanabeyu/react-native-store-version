import { StoreVersionError } from './errors.ts';
import {
  compareSegments,
  compareVersions,
  validateAndParse,
} from './vendor/compare-versions.ts';

/** local と remote の比較結果（v1 の `compareVersion` の戻り値） */
export type CompareResult = 'new' | 'old' | 'equal';

/** v1 の `checkVersion` が返す `detail` */
export type CompareDetail =
  | 'remote > local'
  | 'remote < local'
  | 'remote === local';

/** remote が local より新しいときの、差分の種類 */
export type DiffType = 'major' | 'minor' | 'patch';

/**
 * v1 互換のバージョン比較。不正な値は compare-versions のエラー
 * （`Invalid argument not valid semver ('x' received)` など）をそのまま投げる。
 * v1 のメッセージを変えないために、ここでは包まない
 */
export const compareVersion = (
  local: string,
  remote: string
): CompareResult => {
  switch (compareVersions(local, remote)) {
    case -1:
      return 'new';
    case 1:
      return 'old';
    default:
      return 'equal';
  }
};

/** `compareVersion` の結果から v1 の `detail` を作る */
export const toDetail = (result: CompareResult): CompareDetail => {
  switch (result) {
    case 'new':
      return 'remote > local';
    case 'old':
      return 'remote < local';
    default:
      return 'remote === local';
  }
};

/**
 * remote が local より新しいときの差分の種類。major / minor / patch の数字を比べ、最初に違う所で決める。
 * 3 つとも同じ（4 桁目以降やプレリリースだけの差）なら `patch`。欠けた桁は 0 とみなす。
 * 入力は検証済みであること（不正値は compare-versions のエラーになる）
 */
export const diffType = (local: string, remote: string): DiffType => {
  const l = validateAndParse(local);
  const r = validateAndParse(remote);
  const types: DiffType[] = ['major', 'minor', 'patch'];
  for (let i = 0; i < types.length; i++) {
    // ワイルドカード（`1.x`）は compare-versions と同じく同値として扱われる
    if (compareSegments([l[i]], [r[i]]) !== 0) {
      return types[i];
    }
  }
  return 'patch';
};

/**
 * v2 の判定用の比較。不正値は `StoreVersionError('INVALID_VERSION')`（cause に元のエラー）で投げる。
 * `label` は message に入れる、どの値が不正かの名前（`local` / `remote` / `minimum`）
 */
export const compareVersionStrict = (
  a: string,
  b: string,
  labels: [string, string] = ['local', 'remote']
): CompareResult => {
  for (const [value, label] of [
    [a, labels[0]],
    [b, labels[1]],
  ] as const) {
    try {
      validateAndParse(value);
    } catch (cause) {
      throw new StoreVersionError(
        'INVALID_VERSION',
        `${label} version is invalid: ${JSON.stringify(value)}`,
        { cause }
      );
    }
  }
  return compareVersion(a, b);
};
