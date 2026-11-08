import { compareVersion, toDetail } from '../src/compare.ts';
import { StoreVersionError } from '../src/errors.ts';
import { evaluatePolicy } from '../src/policy.ts';

describe('evaluatePolicy', () => {
  describe('default policy', () => {
    it.each([
      ['1.0.0', '2.0.0', 'force', 'major'],
      ['1.0.0', '1.1.0', 'warning', 'minor'],
      ['1.0.0', '1.0.1', 'warning', 'patch'],
    ])('(%s, %s) is %s', (local, remote, action, diff) => {
      expect(evaluatePolicy(local, remote)).toMatchObject({ action, diff });
    });

    it('treats a difference only in the 4th digit as patch', () => {
      expect(evaluatePolicy('1.2.3', '1.2.3.1')).toEqual({
        result: 'new',
        detail: 'remote > local',
        action: 'warning',
        diff: 'patch',
      });
    });
  });

  describe('policy', () => {
    it('applies a single string to every diff', () => {
      expect(evaluatePolicy('1.0.0', '1.0.1', null, 'force').action).toBe(
        'force'
      );
      expect(evaluatePolicy('1.0.0', '2.0.0', null, 'none').action).toBe(
        'none'
      );
    });

    it('applies per-diff values and falls back to the default for omitted keys', () => {
      const policy = { patch: 'none' } as const;
      expect(evaluatePolicy('1.0.0', '1.0.1', null, policy).action).toBe(
        'none'
      );
      expect(evaluatePolicy('1.0.0', '1.1.0', null, policy).action).toBe(
        'warning'
      );
      expect(evaluatePolicy('1.0.0', '2.0.0', null, policy).action).toBe(
        'force'
      );
      expect(
        evaluatePolicy('1.0.0', '2.0.0', null, { major: 'warning' }).action
      ).toBe('warning');
    });

    it('calls a function with local and remote', () => {
      const policy = jest.fn().mockReturnValue('force');
      expect(evaluatePolicy('1.0.0', '1.0.1', null, policy).action).toBe(
        'force'
      );
      expect(policy).toHaveBeenCalledWith('1.0.0', '1.0.1');
    });

    it('does not call a function when local >= remote', () => {
      const policy = jest.fn().mockReturnValue('force');
      expect(evaluatePolicy('1.0.1', '1.0.1', null, policy).action).toBe(
        'none'
      );
      expect(policy).not.toHaveBeenCalled();
    });
  });

  describe('minimum', () => {
    it('forces when local < minimum regardless of policy', () => {
      expect(evaluatePolicy('1.0.0', '1.0.1', '1.0.1', 'none')).toEqual({
        result: 'new',
        detail: 'remote > local',
        action: 'force',
        diff: 'patch',
      });
    });

    it('forces even when local >= remote, keeping result / detail / diff', () => {
      expect(evaluatePolicy('1.0.0', '1.0.0', '2.0.0')).toEqual({
        result: 'equal',
        detail: 'remote === local',
        action: 'force',
        diff: null,
      });
    });

    it('does not force at exactly the minimum', () => {
      expect(evaluatePolicy('1.0.0', '1.0.1', '1.0.0', 'none').action).toBe(
        'none'
      );
    });

    it.each([[''], [null], [undefined]])(
      'treats %j as not specified',
      (minimum) => {
        expect(evaluatePolicy('1.0.0', '1.0.1', minimum, 'none').action).toBe(
          'none'
        );
      }
    );
  });

  it('returns none when local >= remote', () => {
    expect(evaluatePolicy('1.0.1', '1.0.0')).toEqual({
      result: 'old',
      detail: 'remote < local',
      action: 'none',
      diff: null,
    });
    expect(evaluatePolicy('1.0', '1.0.0').action).toBe('none');
  });

  it.each([
    ['1.0.0', '1.0.1', 'none'],
    ['1.0.0', '2.0.0', 'force'],
    ['2.0.0', '1.0.0', 'warning'],
    ['1.0.0-beta', '1.0.0', 'force'],
  ] as const)(
    'result / detail do not depend on policy (%s, %s, %s)',
    (local, remote, policy) => {
      const r = evaluatePolicy(local, remote, '9.9.9', policy);
      expect(r.result).toBe(compareVersion(local, remote));
      expect(r.detail).toBe(toDetail(compareVersion(local, remote)));
    }
  );

  it('treats prerelease-only differences as patch', () => {
    expect(
      evaluatePolicy('1.2.3-beta', '1.2.3', null, { patch: 'none' })
    ).toMatchObject({
      diff: 'patch',
      action: 'none',
    });
  });

  it.each([
    ['abc', '1.0.0', null, 'local'],
    ['1.0.0', 'Varies with device', null, 'remote'],
    ['1.0.0', '1.0.1', 'abc', 'minimum'],
  ])(
    'throws INVALID_VERSION for (%j, %j, %j)',
    (local, remote, minimum, label) => {
      let caught: unknown;
      try {
        evaluatePolicy(local, remote, minimum);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(StoreVersionError);
      expect((caught as StoreVersionError).code).toBe('INVALID_VERSION');
      expect((caught as StoreVersionError).message).toContain(label);
    }
  );
});
