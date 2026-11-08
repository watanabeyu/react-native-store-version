import { StoreVersionError } from '../src/errors.ts';

describe('StoreVersionError', () => {
  it('has code / name / message', () => {
    const error = new StoreVersionError('NETWORK', 'boom');
    expect(error.code).toBe('NETWORK');
    expect(error.name).toBe('StoreVersionError');
    expect(error.message).toBe('boom');
    expect(error.cause).toBeUndefined();
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
});
