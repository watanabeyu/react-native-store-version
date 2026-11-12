import {
  assertValidVersion,
  type CompareDetail,
  type CompareResult,
  compareVersionOrThrow,
  type DiffType,
  diffType,
  toDetail,
} from './compare.ts';
import { StoreVersionError } from './errors.ts';

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
export const DEFAULT_POLICY: Readonly<Record<DiffType, Action>> = Object.freeze(
  {
    major: 'force',
    minor: 'warning',
    patch: 'warning',
  }
);

/** {@link evaluatePolicy} の結果 */
export type PolicyResult = {
  /** local と remote の比較（policy では変わらない）。remote が比較できず最低バージョンで force になったときだけ null */
  result: CompareResult | null;
  /** v1 と同じ `detail`（policy では変わらない）。`result` が null のときは null */
  detail: CompareDetail | null;
  /** policy と最低バージョンから決まる扱い */
  action: Action;
  /** 差分の種類。`result === 'new'` のときだけ値がある */
  diff: DiffType | null;
  /** 最低バージョンが比較できなかったとき（`MINIMUM_VERSION_FAILED`）。最低バージョンを飛ばして判定した */
  minimumError?: StoreVersionError;
  /** remote が比較できないが最低バージョン未満で force にしたとき（`INVALID_VERSION`） */
  remoteError?: StoreVersionError;
};

/** {@link evaluatePolicy} の引数 */
export type EvaluatePolicyParams = {
  local: string;
  remote: string;
  /** 空文字 / null / undefined は指定なし */
  minimum?: string | null;
  /** 省略 / null / undefined はデフォルト */
  policy?: Policy | null;
};

const ACTIONS: readonly string[] = ['force', 'warning', 'none'];

const toAction = (value: unknown, cause?: unknown): Action => {
  if (typeof value === 'string' && ACTIONS.includes(value)) {
    return value as Action;
  }
  throw new StoreVersionError(
    'POLICY_FAILED',
    `policy returned an invalid action: ${typeof value === 'string' ? JSON.stringify(value) : `(${typeof value})`}`,
    { cause }
  );
};

const resolveAction = (
  policy: Policy,
  diff: DiffType,
  local: string,
  remote: string
): Action => {
  if (typeof policy === 'function') {
    let value: unknown;
    try {
      value = policy(local, remote);
    } catch (cause) {
      throw new StoreVersionError('POLICY_FAILED', 'policy function threw', {
        cause,
      });
    }
    return toAction(value);
  }
  if (typeof policy === 'string') {
    return toAction(policy);
  }
  if (typeof policy === 'object' && policy !== null) {
    return toAction(policy[diff] ?? DEFAULT_POLICY[diff]);
  }
  return toAction(policy);
};

/**
 * 最低バージョンが比較できない値なら、その `MINIMUM_VERSION_FAILED`（cause に compare-versions のエラー）を返す。
 * 有効な値、または空文字 / null / undefined（指定なし）なら undefined。
 * {@link evaluatePolicy} の `minimumError` と同じもの。判定が `INVALID_VERSION` で止まるときにも、
 * 最低バージョンの不正を `onError` に渡せるようにするために分けてある
 */
export const minimumVersionError = (
  minimum: string | null | undefined
): StoreVersionError | undefined => {
  if (minimum == null || minimum === '') {
    return undefined;
  }
  try {
    assertValidVersion(minimum, 'minimum');
    return undefined;
  } catch (e) {
    return new StoreVersionError(
      'MINIMUM_VERSION_FAILED',
      (e as Error).message,
      { cause: (e as StoreVersionError).cause }
    );
  }
};

const POLICY_KEYS: readonly DiffType[] = ['major', 'minor', 'patch'];

const invalidPolicyValue = (value: unknown, key?: DiffType) =>
  new StoreVersionError(
    'POLICY_FAILED',
    `policy${key ? `.${key}` : ''} is an invalid action: ${typeof value === 'string' ? JSON.stringify(value) : `(${typeof value})`}`
  );

/**
 * 値で指定した policy（文字列・オブジェクト）を、差分が出る前に検証する。不正なら `POLICY_FAILED` を投げる。
 * `evaluatePolicy` は差分が出たときにだけ policy を引くので、`local >= remote` の間は不正な値に気づけないため。
 *
 * - null / undefined（デフォルト）と関数は検証しない（関数の戻り値は判定のときに確かめる）
 * - 文字列は `'force' | 'warning' | 'none'` のどれか
 * - オブジェクトは `major` / `minor` / `patch` のうち、null / undefined でない値（省略はデフォルト）がどれも 3 値のどれか
 * - それ以外の型（数値・真偽値など）は不正
 */
export const validatePolicy = (policy: unknown): void => {
  if (policy == null || typeof policy === 'function') {
    return;
  }
  if (typeof policy === 'object') {
    for (const key of POLICY_KEYS) {
      const value = (policy as Partial<Record<DiffType, unknown>>)[key];
      if (value != null && !ACTIONS.includes(value as string)) {
        throw invalidPolicyValue(value, key);
      }
    }
    return;
  }
  if (!ACTIONS.includes(policy as string)) {
    throw invalidPolicyValue(policy);
  }
};

/**
 * ポリシー判定（純粋関数）。順序: 1. `minimum` があり `local < minimum` なら `force`、
 * 2. `local >= remote` なら `none`、3. 差分の種類で policy を引く。
 *
 * - local が比較できない値なら `INVALID_VERSION` を投げる（minimum があっても）
 * - minimum が比較できない値なら、minimum を飛ばして判定を続け、結果に `minimumError` を添える
 * - remote が比較できない値で、minimum が有効かつ `local < minimum` なら、
 *   `{ result: null, detail: null, diff: null, action: 'force', remoteError }` を返す。それ以外は `INVALID_VERSION` を投げる
 * - policy の関数が throw した / 不正な値を返したら `POLICY_FAILED` を投げる
 */
export const evaluatePolicy = ({
  local,
  remote,
  minimum,
  policy,
}: EvaluatePolicyParams): PolicyResult => {
  assertValidVersion(local, 'local');

  const minimumError = minimumVersionError(minimum);
  // local は上で検証済みなので、minimum が有効なら比較は投げない
  const belowMinimum =
    minimum != null &&
    minimum !== '' &&
    minimumError === undefined &&
    compareVersionOrThrow(local, minimum, ['local', 'minimum']) === 'new';

  try {
    assertValidVersion(remote, 'remote');
  } catch (e) {
    if (belowMinimum) {
      return {
        result: null,
        detail: null,
        action: 'force',
        diff: null,
        remoteError: e as StoreVersionError,
      };
    }
    throw e;
  }

  const result = compareVersionOrThrow(local, remote);
  const detail = toDetail(result);
  const diff = result === 'new' ? diffType(local, remote) : null;
  const extra = minimumError ? { minimumError } : {};

  if (belowMinimum) {
    return { result, detail, action: 'force', diff, ...extra };
  }
  if (diff === null) {
    return { result, detail, action: 'none', diff, ...extra };
  }
  const action = resolveAction(policy ?? DEFAULT_POLICY, diff, local, remote);
  return { result, detail, action, diff, ...extra };
};
