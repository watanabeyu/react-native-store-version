import { StoreVersionError } from '../src/errors.ts';
import {
  createAbortError,
  createScope,
  isAbortError,
  raceAbort,
  requestText,
} from '../src/request.ts';
import {
  createResponse,
  mockFetchPending,
  mockFetchResponse,
  requestOf,
} from './__helpers__/fetch.ts';

// request.ts はモジュールの中に取得中の Promise を持つので、テストごとに URL を変えて前のテストの取得と混ざらないようにする
let seq = 0;
const nextUrl = () => {
  seq += 1;
  return `https://example.com/app/${seq}?q=1`;
};

const settle = async <T>(promise: Promise<T>) => {
  try {
    return { value: await promise };
  } catch (error) {
    return { error: error as Error };
  }
};

describe('requestText', () => {
  it('returns the status and body', async () => {
    mockFetchResponse('hello', 404);
    await expect(requestText(nextUrl())).resolves.toEqual({
      status: 404,
      body: 'hello',
    });
  });

  it('sends only the signal when noCache is not set', async () => {
    const spy = mockFetchResponse('ok');
    const url = nextUrl();
    await requestText(url);
    const { url: sent, init } = requestOf(spy);
    expect(sent).toBe(url);
    expect(Object.keys(init ?? {})).toEqual(['signal']);
  });

  it('adds a timestamp and no-cache for noCache (iTunes)', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    const spy = mockFetchResponse('ok');
    const url = nextUrl();
    await requestText(url, { noCache: true });
    const { url: sent, init } = requestOf(spy);
    expect(sent).toBe(`${url}&1234567890`);
    expect(init?.headers).toEqual({ 'cache-control': 'no-cache' });
    expect(init?.signal).toBeDefined();
  });

  it('uses ? for the timestamp when the URL has no query', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(42);
    const spy = mockFetchResponse('ok');
    await requestText('https://example.com/no-query', { noCache: true });
    expect(requestOf(spy).url).toBe('https://example.com/no-query?42');
  });

  describe('in-flight sharing', () => {
    it('makes one fetch for concurrent calls and gives every caller the result', async () => {
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      const a = requestText(url);
      const b = requestText(url);
      const c = requestText(url, { timeoutMs: 5000 });
      expect(spy).toHaveBeenCalledTimes(1);
      calls[0].respond({ body: 'shared' });
      await expect(Promise.all([a, b, c])).resolves.toEqual([
        { status: 200, body: 'shared' },
        { status: 200, body: 'shared' },
        { status: 200, body: 'shared' },
      ]);
    });

    it('shares by the URL before the timestamp', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(1);
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      const a = requestText(url, { noCache: true });
      now.mockReturnValue(2);
      const b = requestText(url, { noCache: true });
      expect(spy).toHaveBeenCalledTimes(1);
      calls[0].respond({ body: 'x' });
      await Promise.all([a, b]);
    });

    it('does not share between noCache and plain requests to the same URL', async () => {
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      const a = requestText(url, { noCache: true });
      const b = requestText(url);
      expect(spy).toHaveBeenCalledTimes(2);
      calls[0].respond({ body: 'a' });
      calls[1].respond({ body: 'b' });
      await expect(a).resolves.toEqual({ status: 200, body: 'a' });
      await expect(b).resolves.toEqual({ status: 200, body: 'b' });
    });

    it('fetches again after the shared request has succeeded', async () => {
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      const first = requestText(url);
      calls[0].respond({ body: 'first' });
      await first;
      const second = requestText(url);
      expect(spy).toHaveBeenCalledTimes(2);
      calls[1].respond({ body: 'second' });
      await expect(second).resolves.toEqual({ status: 200, body: 'second' });
    });

    it('fetches again after the shared request has failed', async () => {
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      const first = requestText(url);
      calls[0].fail(new TypeError('Network request failed'));
      await expect(first).rejects.toMatchObject({ code: 'NETWORK' });
      const second = requestText(url);
      expect(spy).toHaveBeenCalledTimes(2);
      calls[1].respond({ body: 'ok' });
      await expect(second).resolves.toEqual({ status: 200, body: 'ok' });
    });

    it("does not stop the other callers' request when one caller aborts", async () => {
      jest.useFakeTimers();
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      const controller = new AbortController();
      const a = settle(requestText(url, { signal: controller.signal }));
      const b = requestText(url);
      controller.abort();
      const resultA = await a;
      expect(isAbortError(resultA.error)).toBe(true);
      await jest.advanceTimersByTimeAsync(1000);
      expect(calls[0].aborted).toBe(false);
      calls[0].respond({ body: 'for b' });
      await expect(b).resolves.toEqual({ status: 200, body: 'for b' });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('lets a caller that joins right after the only caller aborted take over the request (StrictMode)', async () => {
      jest.useFakeTimers();
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      // 1 回目の effect → cleanup（abort）→ 2 回目の effect が同じタスクのうちに続く
      const first = new AbortController();
      const a = settle(requestText(url, { signal: first.signal }));
      first.abort();
      const second = new AbortController();
      const b = requestText(url, { signal: second.signal });
      await jest.advanceTimersByTimeAsync(0);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(calls[0].aborted).toBe(false);
      calls[0].respond({ body: 'strict' });
      await expect(b).resolves.toEqual({ status: 200, body: 'strict' });
      expect(isAbortError((await a).error)).toBe(true);
    });

    it('stops the fetch when every caller has aborted, and fetches again for the next call', async () => {
      jest.useFakeTimers();
      const { spy, calls } = mockFetchPending();
      const url = nextUrl();
      const c1 = new AbortController();
      const c2 = new AbortController();
      const a = settle(requestText(url, { signal: c1.signal }));
      const b = settle(requestText(url, { signal: c2.signal }));
      c1.abort();
      c2.abort();
      expect(isAbortError((await a).error)).toBe(true);
      expect(isAbortError((await b).error)).toBe(true);
      // 止めるのは次のタスク（StrictMode の 2 回目の effect を待つ）
      expect(calls[0].aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(0);
      expect(calls[0].aborted).toBe(true);
      const next = requestText(url);
      expect(spy).toHaveBeenCalledTimes(2);
      calls[1].respond({ body: 'again' });
      await expect(next).resolves.toEqual({ status: 200, body: 'again' });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('rejects with AbortError without fetching when the signal is already aborted', async () => {
      const { spy } = mockFetchPending();
      const controller = new AbortController();
      controller.abort();
      const result = await settle(
        requestText(nextUrl(), { signal: controller.signal })
      );
      expect(isAbortError(result.error)).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('timeout', () => {
    it('rejects with TIMEOUT and stops the fetch', async () => {
      jest.useFakeTimers();
      const { calls } = mockFetchPending();
      const promise = settle(requestText(nextUrl(), { timeoutMs: 1000 }));
      await jest.advanceTimersByTimeAsync(999);
      expect(calls[0].aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const { error } = await promise;
      expect(error).toBeInstanceOf(StoreVersionError);
      expect(error).toMatchObject({ code: 'TIMEOUT' });
      expect(error?.message).toMatch(/timed out after 1000ms/);
      expect(calls[0].aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not time out when timeoutMs is not given', async () => {
      jest.useFakeTimers();
      const { calls } = mockFetchPending();
      const promise = requestText(nextUrl());
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(calls[0].aborted).toBe(false);
      calls[0].respond({ body: 'late' });
      await expect(promise).resolves.toEqual({ status: 200, body: 'late' });
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'treats timeoutMs %p as no timeout',
      async (timeoutMs) => {
        jest.useFakeTimers();
        const { calls } = mockFetchPending();
        const promise = requestText(nextUrl(), { timeoutMs });
        expect(jest.getTimerCount()).toBe(0);
        calls[0].respond({ body: 'ok' });
        await expect(promise).resolves.toEqual({ status: 200, body: 'ok' });
      }
    );

    it('clears the timer when the request completes', async () => {
      jest.useFakeTimers();
      const { calls } = mockFetchPending();
      const promise = requestText(nextUrl(), { timeoutMs: 1000 });
      expect(jest.getTimerCount()).toBe(1);
      calls[0].respond({ body: 'ok' });
      await promise;
      expect(jest.getTimerCount()).toBe(0);
    });

    it('counts each caller with its own timeoutMs, and stops the fetch when the last one leaves', async () => {
      jest.useFakeTimers();
      const { calls } = mockFetchPending();
      const url = nextUrl();
      const short = settle(requestText(url, { timeoutMs: 1000 }));
      const long = settle(requestText(url, { timeoutMs: 3000 }));
      await jest.advanceTimersByTimeAsync(1000);
      expect((await short).error).toMatchObject({ code: 'TIMEOUT' });
      expect(calls[0].aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(2000);
      expect((await long).error).toMatchObject({ code: 'TIMEOUT' });
      expect(calls[0].aborted).toBe(true);
    });

    it('keeps the fetch for a caller without timeout when another caller times out', async () => {
      jest.useFakeTimers();
      const { calls } = mockFetchPending();
      const url = nextUrl();
      const short = settle(requestText(url, { timeoutMs: 1000 }));
      const patient = requestText(url);
      await jest.advanceTimersByTimeAsync(1000);
      expect((await short).error).toMatchObject({ code: 'TIMEOUT' });
      expect(calls[0].aborted).toBe(false);
      calls[0].respond({ body: 'ok' });
      await expect(patient).resolves.toEqual({ status: 200, body: 'ok' });
    });
  });

  describe('errors', () => {
    it('wraps a fetch rejection in NETWORK with the cause', async () => {
      const cause = new TypeError('Network request failed');
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(cause);
      const url = nextUrl();
      const { error } = await settle(requestText(url));
      expect(error).toBeInstanceOf(StoreVersionError);
      expect(error).toMatchObject({
        code: 'NETWORK',
        message: `request to ${url} failed`,
      });
      expect((error as StoreVersionError).cause).toBe(cause);
    });

    it('wraps a body read failure in NETWORK', async () => {
      const cause = new Error('body stream failed');
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ...createResponse(),
        status: 200,
        text: async () => {
          throw cause;
        },
      } as Response);
      const { error } = await settle(requestText(nextUrl()));
      expect(error).toMatchObject({ code: 'NETWORK' });
      expect((error as StoreVersionError).cause).toBe(cause);
    });
  });
});

describe('createScope', () => {
  it('aborts on the caller signal without marking it as a timeout', () => {
    const controller = new AbortController();
    const scope = createScope({ signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    expect(scope.signal.aborted).toBe(true);
    expect(scope.timedOut).toBe(false);
  });

  it('starts aborted when the caller signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(createScope({ signal: controller.signal }).signal.aborted).toBe(
      true
    );
  });

  it('marks a timeout and clears the timer on dispose', () => {
    jest.useFakeTimers();
    const timed = createScope({ timeoutMs: 10 });
    jest.advanceTimersByTime(10);
    expect(timed.signal.aborted).toBe(true);
    expect(timed.timedOut).toBe(true);

    const disposed = createScope({ timeoutMs: 10 });
    disposed.dispose();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10);
    expect(disposed.signal.aborted).toBe(false);
  });

  it('caps very long timeouts instead of firing at once', () => {
    jest.useFakeTimers();
    const scope = createScope({ timeoutMs: 2 ** 40 });
    jest.advanceTimersByTime(1000);
    expect(scope.signal.aborted).toBe(false);
    scope.dispose();
  });

  it('abort() aborts without a timeout', () => {
    const scope = createScope({ timeoutMs: 1000 });
    scope.abort();
    expect(scope.signal.aborted).toBe(true);
    expect(scope.timedOut).toBe(false);
  });
});

describe('raceAbort', () => {
  it('resolves with the promise when it finishes first', async () => {
    const controller = new AbortController();
    await expect(
      raceAbort(Promise.resolve('done'), controller.signal)
    ).resolves.toBe('done');
  });

  it('passes the rejection through', async () => {
    const controller = new AbortController();
    const error = new Error('boom');
    await expect(
      raceAbort(Promise.reject(error), controller.signal)
    ).rejects.toBe(error);
  });

  it('rejects with AbortError on abort, and a later rejection is not unhandled', async () => {
    const controller = new AbortController();
    let reject: (e: unknown) => void = () => {};
    const pending = new Promise((_, r) => {
      reject = r;
    });
    const raced = settle(raceAbort(pending, controller.signal));
    controller.abort();
    expect(isAbortError((await raced).error)).toBe(true);
    reject(new Error('later'));
    await Promise.resolve();
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { error } = await settle(
      raceAbort(new Promise(() => {}), controller.signal)
    );
    expect(isAbortError(error)).toBe(true);
  });
});

describe('isAbortError', () => {
  it.each([
    [createAbortError(), true],
    [Object.assign(new Error('x'), { name: 'AbortError' }), true],
    [new Error('x'), false],
    [null, false],
    ['AbortError', false],
  ])('%p -> %p', (value, expected) => {
    expect(isAbortError(value)).toBe(expected);
  });
});
