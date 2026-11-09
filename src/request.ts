// ストアへの取得の共通部分（タイムアウト / in-flight の共有 / iTunes のキャッシュ回避）。
// react-native を import しない（Node でも動かす。Phase 5 の canary で使う）。
// 古い Hermes に無い API（AbortSignal.timeout / AbortSignal.any / DOMException など）は使わず、
// AbortController と setTimeout だけで組む
import { StoreVersionError } from './errors.ts';

/**
 * 呼び出し元の `signal` が abort されたときに投げるエラー（`name === 'AbortError'`）。
 * 古い Hermes には DOMException が無いので、name だけを合わせた Error にする
 */
export const createAbortError = (): Error => {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
};

/** `createAbortError` や fetch の abort で投げられたエラーか */
export const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'AbortError';

// setTimeout は 2^31 - 1 ms を超えるとすぐに発火する（オーバーフロー）ので、そこで頭打ちにする
const MAX_TIMEOUT_MS = 2147483647;

/** タイムアウトを入れるか。正の有限の数のときだけ（0 / 負 / NaN / Infinity / 未指定はタイムアウトなし） */
const hasTimeout = (timeoutMs: number | undefined): timeoutMs is number =>
  typeof timeoutMs === 'number' && timeoutMs > 0 && timeoutMs !== Infinity;

/** 呼び出し元の signal とタイムアウトを 1 つにまとめた signal（{@link createScope}） */
export type Scope = {
  /** 呼び出し元の signal が abort されたとき、またはタイムアウトしたときに abort される */
  readonly signal: AbortSignal;
  /** abort の理由がタイムアウトだったか */
  readonly timedOut: boolean;
  /** 自分から abort する（タイムアウト扱いにはしない） */
  abort(): void;
  /** タイマーと呼び出し元の signal への登録を外す（終わったら必ず呼ぶ） */
  dispose(): void;
};

/**
 * 呼び出し元の `signal` と `timeoutMs` から、どちらかで abort される signal を作る。
 * `timeoutMs` が未指定（または正の有限の数でない）ならタイムアウトしない
 */
export const createScope = ({
  signal,
  timeoutMs,
}: {
  signal?: AbortSignal;
  timeoutMs?: number;
} = {}): Scope => {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const dispose = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    signal?.removeEventListener('abort', onAbort);
  };
  function onAbort() {
    dispose();
    controller.abort();
  }

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', onAbort);
    if (hasTimeout(timeoutMs)) {
      timer = setTimeout(
        () => {
          timer = undefined;
          timedOut = true;
          dispose();
          controller.abort();
        },
        Math.min(timeoutMs, MAX_TIMEOUT_MS)
      );
    }
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    abort: () => {
      dispose();
      controller.abort();
    },
    dispose,
  };
};

/**
 * `promise` の完了か `signal` の abort の早い方で終わる。abort なら `createAbortError()` で reject する。
 * `signal` を見ない処理（開発者の `getLatestVersion` など）を、タイムアウトや呼び出し元の abort で打ち切るため。
 * 打ち切った後に `promise` が reject しても unhandled rejection にはならない
 */
export const raceAbort = <T>(
  promise: PromiseLike<T>,
  signal: AbortSignal
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort);
    }
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });

/** {@link requestText} の結果。成功・失敗を問わず status と本文を返す（status の扱いは fetcher が決める） */
export type TextResponse = {
  readonly status: number;
  readonly body: string;
};

/** {@link requestText} のオプション */
export type RequestOptions = {
  /**
   * この呼び出し元のタイムアウト（ms）。未指定ならタイムアウトしない（10 秒の既定は Provider が渡す）。
   * 共有中の取得に後から加わった呼び出し元も、自分の `timeoutMs` で数える（ほかの呼び出し元の値には影響されない）。
   * 時間切れの呼び出し元だけが `TIMEOUT` で抜け、その時点で待っている呼び出し元がいなければ fetch も止める
   */
  timeoutMs?: number;
  /**
   * この呼び出し元の取り消し。abort するとこの呼び出し元だけが `AbortError` で抜ける。
   * ほかの呼び出し元が同じ取得を待っていれば fetch は続く
   */
  signal?: AbortSignal;
  /**
   * iTunes Lookup の CDN キャッシュを避ける（D40）。URL の末尾にタイムスタンプ（`&<ts>`）を付け、
   * `cache-control: no-cache` を送る（v1 と同じ形）
   */
  noCache?: boolean;
};

// 本文の読み込みに失敗した NETWORK のエラーと、その応答の status。StoreVersionError にフィールドを足さずに（公開の形を変えずに）
// v1 互換の checkVersion へ status を渡すため。WeakMap なのでエラーが捨てられれば消える（キャッシュではない）
const failedResponseStatus = new WeakMap<object, number>();

/**
 * {@link requestText} の `NETWORK` のうち、応答（status）は受け取ったが本文の読み込みに失敗したものなら、その status を返す。
 * fetch 自体が失敗した場合やほかの値なら undefined。v1 互換の checkVersion が、v1 と同じく Android の 200 以外を
 * 本文より先に `androidStoreURL is invalid.` にするために使う（パッケージの入口からは export しない）
 */
export const failedResponseStatusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null
    ? failedResponseStatus.get(error)
    : undefined;

type Entry = {
  key: string;
  promise: Promise<TextResponse>;
  controller: AbortController;
  /** この取得を待っている呼び出し元の数 */
  waiters: number;
  settled: boolean;
  /** 待っている呼び出し元が 0 になってから fetch を止めるまでのタイマー */
  idleTimer: ReturnType<typeof setTimeout> | undefined;
};

// 取得中のものだけを持つ（完了したら消す。結果は保持しない。D20）。キーはタイムスタンプを付ける前の取得先
const inflight = new Map<string, Entry>();

const clearIdleTimer = (entry: Entry) => {
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
};

/** 誰も待っていなければ fetch を止める。後から来た呼び出し元は新しく取り直す */
const stopIfIdle = (entry: Entry) => {
  clearIdleTimer(entry);
  if (entry.settled || entry.waiters > 0) {
    return;
  }
  if (inflight.get(entry.key) === entry) {
    inflight.delete(entry.key);
  }
  entry.controller.abort();
};

const start = (key: string, url: string, noCache: boolean): Entry => {
  const controller = new AbortController();
  // v1 と同じく、タイムスタンプはクエリの最後に `&<ts>` で付ける（D40）
  const target = noCache
    ? `${url}${url.includes('?') ? '&' : '?'}${Date.now()}`
    : url;
  const init: RequestInit = noCache
    ? { headers: { 'cache-control': 'no-cache' }, signal: controller.signal }
    : { signal: controller.signal };

  const promise = (async (): Promise<TextResponse> => {
    let status: number | undefined;
    try {
      const response = await fetch(target, init);
      status = response.status;
      return { status, body: await response.text() };
    } catch (cause) {
      const error = new StoreVersionError(
        'NETWORK',
        `request to ${url} failed`,
        { cause }
      );
      // 応答は来たが本文の読み込みに失敗した場合だけ、その status を添える（{@link failedResponseStatusOf}）
      if (typeof status === 'number') {
        failedResponseStatus.set(error, status);
      }
      throw error;
    }
  })();

  const entry: Entry = {
    key,
    promise,
    controller,
    waiters: 0,
    settled: false,
    idleTimer: undefined,
  };
  const settle = () => {
    entry.settled = true;
    clearIdleTimer(entry);
    if (inflight.get(key) === entry) {
      inflight.delete(key);
    }
  };
  // 待っている呼び出し元が全員抜けた後の reject（abort）も、ここで受けるので unhandled rejection にならない
  promise.then(settle, settle);
  return entry;
};

/**
 * `url` を取得して status と本文を返す。同じ取得先（タイムスタンプを付ける前の URL と `noCache`）への同時の呼び出しは
 * 1 回の fetch にまとめ、完了したら（成功・失敗とも）共有をやめる（次の呼び出しは取り直す。キャッシュしない）。
 *
 * - 通信の失敗（fetch の reject / 本文の読み込みの失敗）は `StoreVersionError('NETWORK')`（cause に元のエラー）
 * - この呼び出し元のタイムアウトは `StoreVersionError('TIMEOUT')`
 * - この呼び出し元の `signal` の abort は `AbortError`（{@link isAbortError}）
 * - 実際の fetch を止めるのは、待っている呼び出し元が全員抜けたとき。タイムアウトで抜けた場合はすぐ止め、
 *   abort で抜けた場合は次のタスクまで待ってから止める（StrictMode では 1 回目の effect の cleanup の abort の直後に
 *   2 回目の effect が同じ取得に加わるので、それを受け取れるようにするため）。上位（resolve など）のタイムアウトは
 *   `signal` の abort として届くので、abort と同じく次のタスクで止める
 *
 * HTTP の status は見ない（200 以外の扱いは fetcher が決める）
 */
export const requestText = (
  url: string,
  { timeoutMs, signal, noCache = false }: RequestOptions = {}
): Promise<TextResponse> =>
  new Promise<TextResponse>((resolve, reject) => {
    const scope = createScope({ signal, timeoutMs });
    if (scope.signal.aborted) {
      reject(createAbortError());
      return;
    }

    const key = `${noCache ? 'no-cache ' : ''}${url}`;
    let entry = inflight.get(key);
    if (!entry) {
      entry = start(key, url, noCache);
      inflight.set(key, entry);
    }
    const joined = entry;
    joined.waiters += 1;
    clearIdleTimer(joined);

    let done = false;
    const finish = () => {
      done = true;
      scope.signal.removeEventListener('abort', onLeave);
      scope.dispose();
    };
    // finish() で外すので、結果を受け取った後には呼ばれない
    function onLeave() {
      const timedOut = scope.timedOut;
      finish();
      joined.waiters -= 1;
      if (joined.waiters === 0) {
        if (timedOut) {
          stopIfIdle(joined);
        } else {
          joined.idleTimer = setTimeout(() => stopIfIdle(joined), 0);
        }
      }
      reject(
        timedOut
          ? new StoreVersionError(
              'TIMEOUT',
              `request to ${url} timed out after ${timeoutMs}ms`
            )
          : createAbortError()
      );
    }
    scope.signal.addEventListener('abort', onLeave);

    joined.promise.then(
      (value) => {
        if (!done) {
          finish();
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!done) {
          finish();
          reject(error);
        }
      }
    );
  });
