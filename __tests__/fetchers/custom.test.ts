import { StoreVersionError } from '../../src/errors.ts';
import {
  callLatestVersion,
  callMinimumVersion,
  type VersionGetter,
} from '../../src/fetchers/custom.ts';

const ctx = () => ({
  platform: 'ios' as const,
  signal: new AbortController().signal,
});

const catchError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as StoreVersionError;
  }
  throw new Error('did not reject');
};

describe('callLatestVersion', () => {
  it('passes platform and signal and returns the value', async () => {
    const getter = jest.fn<
      ReturnType<VersionGetter>,
      Parameters<VersionGetter>
    >(async () => '2.4.0');
    const context = ctx();
    await expect(callLatestVersion(getter, context)).resolves.toBe('2.4.0');
    expect(getter).toHaveBeenCalledWith(context);
    expect(getter.mock.calls[0][0].signal).toBe(context.signal);
  });

  it('returns a non-comparable string as is', async () => {
    await expect(callLatestVersion(async () => 'abc', ctx())).resolves.toBe(
      'abc'
    );
  });

  it.each([
    ['async throw', async () => Promise.reject(new Error('boom'))],
    [
      'sync throw',
      (() => {
        throw new Error('boom');
      }) as VersionGetter,
    ],
  ])('wraps %s in LATEST_VERSION_FAILED with the cause', async (_, getter) => {
    const error = await catchError(callLatestVersion(getter, ctx()));
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error.code).toBe('LATEST_VERSION_FAILED');
    expect((error.cause as Error).message).toBe('boom');
  });

  it.each([
    ['', 'getLatestVersion returned an empty string'],
    [null, 'getLatestVersion returned an invalid value: null'],
    [undefined, 'getLatestVersion returned an invalid value: (undefined)'],
    [1, 'getLatestVersion returned an invalid value: (number)'],
  ])('rejects %p with LATEST_VERSION_FAILED', async (value, message) => {
    const error = await catchError(
      callLatestVersion(async () => value as string, ctx())
    );
    expect(error).toMatchObject({ code: 'LATEST_VERSION_FAILED', message });
  });
});

describe('callMinimumVersion', () => {
  it('passes platform and signal and returns the value', async () => {
    const getter = jest.fn(async () => '2.3.0');
    const context = { ...ctx(), platform: 'android' as const };
    await expect(callMinimumVersion(getter, context)).resolves.toBe('2.3.0');
    expect(getter).toHaveBeenCalledWith(context);
  });

  it.each([[''], [null], [undefined]])(
    'treats %p as not specified',
    async (value) => {
      await expect(
        callMinimumVersion(async () => value, ctx())
      ).resolves.toBeNull();
    }
  );

  it('returns a non-comparable string as is (evaluatePolicy skips it)', async () => {
    await expect(callMinimumVersion(async () => 'abc', ctx())).resolves.toBe(
      'abc'
    );
  });

  it('wraps a throw in MINIMUM_VERSION_FAILED with the cause', async () => {
    const cause = new Error('remote config failed');
    const error = await catchError(
      callMinimumVersion(async () => Promise.reject(cause), ctx())
    );
    expect(error).toMatchObject({
      code: 'MINIMUM_VERSION_FAILED',
      message: 'getMinimumVersion threw',
    });
    expect(error.cause).toBe(cause);
  });

  it('rejects a non-string value with MINIMUM_VERSION_FAILED', async () => {
    const error = await catchError(
      callMinimumVersion(async () => 2 as unknown as string, ctx())
    );
    expect(error).toMatchObject({
      code: 'MINIMUM_VERSION_FAILED',
      message: 'getMinimumVersion returned an invalid value: (number)',
    });
  });
});
