// src/policy.ts に後から足した検証（validatePolicy / minimumVersionError）のテスト。
// policy.test.ts は変えない方針なので、別のファイルに置く
import { StoreVersionError } from '../src/errors.ts';
import {
  evaluatePolicy,
  minimumVersionError,
  validatePolicy,
} from '../src/policy.ts';

const catchError = (fn: () => unknown): StoreVersionError => {
  try {
    fn();
  } catch (e) {
    return e as StoreVersionError;
  }
  throw new Error('did not throw');
};

describe('validatePolicy', () => {
  it.each([
    [undefined],
    [null],
    ['force'],
    ['warning'],
    ['none'],
    [{}],
    [{ major: 'warning' }],
    [{ major: 'force', minor: 'none', patch: 'warning' }],
    [{ major: null, minor: undefined }],
    [() => 'nonsense'],
  ])('accepts %p', (policy) => {
    expect(() => validatePolicy(policy)).not.toThrow();
  });

  it.each([
    ['always', 'policy is an invalid action: "always"'],
    ['', 'policy is an invalid action: ""'],
    [1, 'policy is an invalid action: (number)'],
    [true, 'policy is an invalid action: (boolean)'],
    [{ minor: 'block' }, 'policy.minor is an invalid action: "block"'],
    [{ patch: 0 }, 'policy.patch is an invalid action: (number)'],
  ])('rejects %p with POLICY_FAILED', (policy, message) => {
    const error = catchError(() => validatePolicy(policy));
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error).toMatchObject({ code: 'POLICY_FAILED', message });
  });
});

describe('minimumVersionError', () => {
  it.each([[undefined], [null], [''], ['2.3.0'], ['v2'], ['1.x']])(
    'returns undefined for %p',
    (minimum) => {
      expect(minimumVersionError(minimum)).toBeUndefined();
    }
  );

  it('returns the same error as evaluatePolicy for an invalid minimum', () => {
    const error = minimumVersionError('abc');
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error?.code).toBe('MINIMUM_VERSION_FAILED');
    const { minimumError } = evaluatePolicy({
      local: '1.0.0',
      remote: '1.0.0',
      minimum: 'abc',
    });
    expect(error?.message).toBe(minimumError?.message);
    expect(error?.message).toBe('minimum version is invalid: "abc"');
    expect((error?.cause as Error | undefined)?.message).toBe(
      (minimumError?.cause as Error | undefined)?.message
    );
    expect(error?.cause).toBeInstanceOf(Error);
  });
});
