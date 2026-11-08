import { StoreVersionError } from '../src/errors.ts';

describe('StoreVersionError', () => {
  it('has code / name / message', () => {
    const error = new StoreVersionError('NETWORK', 'boom');
    expect(error.code).toBe('NETWORK');
    expect(error.name).toBe('StoreVersionError');
    expect(error.message).toBe('boom');
    expect(error.cause).toBeUndefined();
    expect('cause' in error).toBe(false);
  });

  it('is an instance of Error and StoreVersionError', () => {
    const error = new StoreVersionError('TIMEOUT', 'slow');
    expect(error).toBeInstanceOf(StoreVersionError);
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps cause', () => {
    const cause = new Error('original');
    const error = new StoreVersionError('PARSE_FAILED', 'bad', { cause });
    expect(error.cause).toBe(cause);
  });

  it('keeps a falsy cause', () => {
    const error = new StoreVersionError('NOT_FOUND', 'none', { cause: 0 });
    expect(error.cause).toBe(0);
  });

  it('accepts POLICY_FAILED', () => {
    expect(new StoreVersionError('POLICY_FAILED', 'x').code).toBe(
      'POLICY_FAILED'
    );
  });

  // 古い Hermes は Error の第 2 引数（cause）を無視する。その環境の代わりに、第 2 引数を無視する Error を差し込む
  describe('when the runtime ignores the Error options (old Hermes)', () => {
    const NativeError = globalThis.Error;

    afterEach(() => {
      globalThis.Error = NativeError;
    });

    const load = (): typeof StoreVersionError => {
      class LegacyError extends NativeError {
        constructor(message?: string) {
          super(message);
        }
      }
      globalThis.Error = LegacyError as unknown as ErrorConstructor;
      let Loaded!: typeof StoreVersionError;
      jest.isolateModules(() => {
        Loaded = require('../src/errors.ts').StoreVersionError;
      });
      return Loaded;
    };

    it('still keeps cause (including falsy), non-enumerable', () => {
      const Legacy = load();
      const cause = new NativeError('original');
      const error = new Legacy('NETWORK', 'x', { cause });
      expect(error.cause).toBe(cause);
      expect(Object.keys(error)).not.toContain('cause');
      expect(new Legacy('NETWORK', 'x', { cause: 0 }).cause).toBe(0);
    });

    it('has no cause without options', () => {
      const Legacy = load();
      const error = new Legacy('NETWORK', 'x');
      expect('cause' in error).toBe(false);
      expect(error.cause).toBeUndefined();
    });
  });
});
