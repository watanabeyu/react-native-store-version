import { StoreVersionError } from '../src/errors.ts';
import { DEFAULT_POLICY, evaluatePolicy, type Policy } from '../src/policy.ts';

const run = (
  local: string,
  remote: string,
  minimum?: string | null,
  policy?: Policy | null
) => evaluatePolicy({ local, remote, minimum, policy });

const catchError = (fn: () => unknown): StoreVersionError => {
  try {
    fn();
  } catch (e) {
    return e as StoreVersionError;
  }
  throw new Error('did not throw');
};

describe('evaluatePolicy', () => {
  it('freezes the default policy', () => {
    expect(DEFAULT_POLICY).toEqual({
      major: 'force',
      minor: 'warning',
      patch: 'warning',
    });
    expect(Object.isFrozen(DEFAULT_POLICY)).toBe(true);
  });

  describe('default policy', () => {
    it.each([
      ['1.0.0', '2.0.0', 'force', 'major'],
      ['1.0.0', '1.1.0', 'warning', 'minor'],
      ['1.0.0', '1.0.1', 'warning', 'patch'],
    ])('(%s, %s) is %s', (local, remote, action, diff) => {
      expect(run(local, remote)).toMatchObject({ action, diff });
    });

    it('treats a difference only in the 4th digit as patch', () => {
      expect(run('1.2.3', '1.2.3.1')).toEqual({
        result: 'new',
        detail: 'remote > local',
        action: 'warning',
        diff: 'patch',
      });
    });

    it('treats prerelease-only differences as patch', () => {
      expect(run('1.2.3-beta', '1.2.3', null, { patch: 'none' })).toMatchObject(
        { diff: 'patch', action: 'none' }
      );
    });

    it.each([[null], [undefined]])(
      'uses the default when policy is %j',
      (policy) => {
        expect(run('1.0.0', '2.0.0', null, policy).action).toBe('force');
      }
    );
  });

  describe('policy', () => {
    it('applies a single string to every diff', () => {
      expect(run('1.0.0', '1.0.1', null, 'force').action).toBe('force');
      expect(run('1.0.0', '2.0.0', null, 'none').action).toBe('none');
    });

    it('applies per-diff values and falls back to the default for omitted keys', () => {
      const policy = { patch: 'none' } as const;
      expect(run('1.0.0', '1.0.1', null, policy).action).toBe('none');
      expect(run('1.0.0', '1.1.0', null, policy).action).toBe('warning');
      expect(run('1.0.0', '2.0.0', null, policy).action).toBe('force');
      expect(run('1.0.0', '2.0.0', null, { major: 'warning' }).action).toBe(
        'warning'
      );
    });

    it('calls a function with local and remote', () => {
      const policy = jest.fn().mockReturnValue('force');
      expect(run('1.0.0', '1.0.1', null, policy).action).toBe('force');
      expect(policy).toHaveBeenCalledWith('1.0.0', '1.0.1');
    });

    it('does not call a function when local >= remote', () => {
      const policy = jest.fn().mockReturnValue('force');
      expect(run('1.0.1', '1.0.1', null, policy).action).toBe('none');
      expect(policy).not.toHaveBeenCalled();
    });

    it('throws POLICY_FAILED with the cause when the function throws', () => {
      const boom = new Error('boom');
      const error = catchError(() =>
        run('1.0.0', '2.0.0', null, () => {
          throw boom;
        })
      );
      expect(error).toBeInstanceOf(StoreVersionError);
      expect(error.code).toBe('POLICY_FAILED');
      expect(error.cause).toBe(boom);
    });

    it.each([
      ['a function returning an invalid value', () => 'block'],
      ['a function returning undefined', () => undefined],
      ['an invalid string', 'block'],
      ['an invalid object value', { major: 'block' }],
      ['an invalid object value (non-string)', { major: 1 }],
    ])('throws POLICY_FAILED for %s', (_name, policy) => {
      const error = catchError(() =>
        run('1.0.0', '2.0.0', null, policy as unknown as Policy)
      );
      expect(error.code).toBe('POLICY_FAILED');
    });

    it('throws POLICY_FAILED for a policy of the wrong type', () => {
      expect(
        catchError(() => run('1.0.0', '2.0.0', null, 1 as unknown as Policy))
          .code
      ).toBe('POLICY_FAILED');
    });
  });

  // result / detail は policy では変わらない。期待値は比較関数から作らずリテラルで書く
  describe('result / detail do not depend on policy', () => {
    const policies: Policy[] = [
      'force',
      'warning',
      'none',
      { major: 'none' },
      () => 'none',
    ];

    it.each(policies)('new (%p)', (policy) => {
      expect(run('1.0.0', '2.0.0', null, policy)).toMatchObject({
        result: 'new',
        detail: 'remote > local',
        diff: 'major',
      });
    });

    it.each(policies)('old (%p)', (policy) => {
      expect(run('2.0.0', '1.0.0', null, policy)).toEqual({
        result: 'old',
        detail: 'remote < local',
        action: 'none',
        diff: null,
      });
    });

    it.each(policies)('equal (%p)', (policy) => {
      expect(run('1.0', '1.0.0', null, policy)).toEqual({
        result: 'equal',
        detail: 'remote === local',
        action: 'none',
        diff: null,
      });
    });
  });

  describe('minimum', () => {
    it('forces when local < minimum regardless of policy', () => {
      expect(run('1.0.0', '1.0.1', '1.0.1', 'none')).toEqual({
        result: 'new',
        detail: 'remote > local',
        action: 'force',
        diff: 'patch',
      });
    });

    it('forces even when local >= remote, keeping result / detail / diff', () => {
      expect(run('1.0.0', '1.0.0', '2.0.0')).toEqual({
        result: 'equal',
        detail: 'remote === local',
        action: 'force',
        diff: null,
      });
    });

    it('keeps result / detail / diff for old as well', () => {
      expect(run('1.0.0', '0.9.0', '2.0.0', 'none')).toEqual({
        result: 'old',
        detail: 'remote < local',
        action: 'force',
        diff: null,
      });
    });

    it('does not force at exactly the minimum', () => {
      expect(run('1.0.0', '1.0.1', '1.0.0', 'none').action).toBe('none');
    });

    it.each([[''], [null], [undefined]])(
      'treats %j as not specified',
      (minimum) => {
        const r = run('1.0.0', '1.0.1', minimum, 'none');
        expect(r.action).toBe('none');
        expect(r.minimumError).toBeUndefined();
      }
    );

    describe('invalid minimum', () => {
      it('skips the minimum, continues and attaches minimumError', () => {
        const r = run('1.0.0', '1.1.0', 'Varies with device', {
          minor: 'none',
        });
        expect(r).toMatchObject({
          result: 'new',
          detail: 'remote > local',
          action: 'none',
          diff: 'minor',
        });
        expect(r.minimumError).toBeInstanceOf(StoreVersionError);
        expect(r.minimumError?.code).toBe('MINIMUM_VERSION_FAILED');
        expect(r.minimumError?.cause).toBeInstanceOf(Error);
        expect(r.minimumError?.message).toContain('minimum');
      });

      it('attaches minimumError when local >= remote as well', () => {
        const r = run('1.0.0', '1.0.0', '1.2.3.4.5');
        expect(r.action).toBe('none');
        expect(r.minimumError?.code).toBe('MINIMUM_VERSION_FAILED');
      });

      it('treats a non-string minimum as invalid', () => {
        const r = run('1.0.0', '1.0.1', 5 as unknown as string);
        expect(r.minimumError?.code).toBe('MINIMUM_VERSION_FAILED');
        expect(r.action).toBe('warning');
      });
    });
  });

  describe('invalid versions', () => {
    it.each([
      ['abc', '1.0.0', null],
      ['abc', '1.0.0', '2.0.0'],
      ['abc', '1.0.0', 'xyz'],
      ['', '1.0.0', null],
    ])('local %j is INVALID_VERSION (minimum %j)', (local, remote, minimum) => {
      const error = catchError(() => run(local, remote, minimum));
      expect(error.code).toBe('INVALID_VERSION');
      expect(error.message).toContain('local');
      expect(error.cause).toBeInstanceOf(Error);
    });

    it.each([
      ['no minimum', null],
      ['minimum not exceeded', '1.0.0'],
      ['invalid minimum', 'xyz'],
    ])('remote invalid with %s throws INVALID_VERSION', (_name, minimum) => {
      const error = catchError(() =>
        run('1.0.0', 'Varies with device', minimum)
      );
      expect(error.code).toBe('INVALID_VERSION');
      expect(error.message).toContain('remote');
    });

    it('forces with remoteError when remote is invalid and local < minimum', () => {
      const r = run('1.0.0', 'Varies with device', '2.0.0', 'none');
      expect(r).toMatchObject({
        result: null,
        detail: null,
        diff: null,
        action: 'force',
      });
      expect(r.remoteError).toBeInstanceOf(StoreVersionError);
      expect(r.remoteError?.code).toBe('INVALID_VERSION');
      expect(r.minimumError).toBeUndefined();
    });
  });

  describe('accepted forms', () => {
    it('compares wildcards and range prefixes as valid values', () => {
      expect(run('1.x.0', '1.5.1')).toMatchObject({
        result: 'new',
        diff: 'patch',
      });
      expect(run('^1.0.0', '>=2.0.0')).toMatchObject({
        result: 'new',
        diff: 'major',
      });
      expect(run('V1.0.0', 'v1.0.0').result).toBe('equal');
      expect(run('1.0.0', '1.0.0', '~1.2.3').action).toBe('force');
    });
  });
});
