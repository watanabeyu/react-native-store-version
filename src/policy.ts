import type { DiffType } from './compare.ts';
import {
  type CompareDetail,
  type CompareResult,
  compareVersionStrict,
  diffType,
  toDetail,
} from './compare.ts';

/** 判定の結果。`force` は強制、`warning` は警告、`none` は何も出さない */
export type Action = 'force' | 'warning' | 'none';

export type { DiffType };

/**
 * ストアとの差分に対する扱い。
 *
 * - 文字列 1 つ: 差分の種類によらずその値
 * - オブジェクト: 差分の種類（`major` / `minor` / `patch`）ごとの値。省略したキーはデフォルト
 *   （`{ major: 'force', minor: 'warning', patch: 'warning' }`）
 * - 関数: `(local, remote)` から値を返す
 *
 * 注意（Android の段階公開）: Android で段階公開を使う場合、公開対象外のユーザーは新バージョンを
 * 入手できないため、ストア差分による `force` でアプリを使えなくなる可能性がある。
 * `Platform.OS === 'android'` のときは `major: 'warning'` にするか、`getMinimumVersion` で
 * force を制御すること。iOS の段階的リリースは自動アップデートの配信ペースだけを制御し、
 * App Store から手動ならいつでも更新できるので問題ない。
 */
export type Policy =
  | Action
  | Partial<Record<DiffType, Action>>
  | ((local: string, remote: string) => Action);

/** デフォルトの policy */
export const DEFAULT_POLICY: Record<DiffType, Action> = {
  major: 'force',
  minor: 'warning',
  patch: 'warning',
};

/** {@link evaluatePolicy} の結果 */
export type PolicyResult = {
  /** local と remote の比較（policy では変わらない） */
  result: CompareResult;
  /** v1 と同じ `detail`（policy では変わらない） */
  detail: CompareDetail;
  /** policy と最低バージョンから決まる扱い */
  action: Action;
  /** 差分の種類。`result === 'new'` のときだけ値がある */
  diff: DiffType | null;
};

/**
 * ポリシー判定（純粋関数）。順序: 1. `minimum` があり `local < minimum` なら `force`、
 * 2. `local >= remote` なら `none`、3. 差分の種類で policy を引く。
 * 比較できない値は `StoreVersionError('INVALID_VERSION')` を投げる
 */
export const evaluatePolicy = (
  local: string,
  remote: string,
  minimum?: string | null,
  policy: Policy = DEFAULT_POLICY
): PolicyResult => {
  const result = compareVersionStrict(local, remote);
  const detail = toDetail(result);
  const diff = result === 'new' ? diffType(local, remote) : null;

  if (
    minimum != null &&
    minimum !== '' &&
    compareVersionStrict(local, minimum, ['local', 'minimum']) === 'new'
  ) {
    return { result, detail, action: 'force', diff };
  }

  if (diff === null) {
    return { result, detail, action: 'none', diff };
  }

  let action: Action;
  if (typeof policy === 'function') {
    action = policy(local, remote);
  } else if (typeof policy === 'string') {
    action = policy;
  } else {
    action = policy[diff] ?? DEFAULT_POLICY[diff];
  }
  return { result, detail, action, diff };
};
