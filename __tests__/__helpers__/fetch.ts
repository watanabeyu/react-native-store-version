// global.fetch を差し替えて、実ストアにアクセスせず fixture を返すヘルパー（RN の jest setup は fetch をモックしない）。
// v1 の src は ios が `.text()`、android が `.status` と `.text()` だけを使う（v2 の src/request.ts も `.status` と `.text()` だけ）。
//
// テストの tsconfig は types を ["jest"] にしていて @types/node を入れていないので、fs は jest.requireActual で型を指定して使う
declare const __dirname: string;
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
}>('node:fs');

export const readFixture = (name: string): string =>
  fs.readFileSync(`${__dirname}/../__fixtures__/${name}`, 'utf8');

export const mockFetchResponse = (body: string, status = 200) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  } as Response);

export const mockFetchFixture = (name: string, status = 200) =>
  mockFetchResponse(readFixture(name), status);

export const mockFetchReject = (error: unknown) =>
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(error);

// ---- 2c で追加（v2 の request / fetcher 用） ----

/** モックの Response の中身。`json` を渡すと `text()` はその JSON.stringify を返す */
export type MockResponseInit = {
  status?: number;
  body?: string;
  json?: unknown;
  headers?: Record<string, string>;
};

/** `status` / `ok` / `headers.get()` / `text()` / `json()` を返せる Response */
export const createResponse = ({
  status = 200,
  body,
  json,
  headers = {},
}: MockResponseInit = {}): Response => {
  const text = body ?? (json === undefined ? '' : JSON.stringify(json));
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
};

/** fetch が受け取る abort のエラー（DOMException が無い環境でも name で判定できる形） */
export const createAbortError = (): Error => {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
};

/** 保留中の 1 回の fetch。`respond` / `fail` で完了させる */
export type PendingFetch = {
  url: string;
  init: RequestInit | undefined;
  respond: (init?: MockResponseInit) => void;
  fail: (error: unknown) => void;
  /** init.signal が abort されたか */
  readonly aborted: boolean;
};

/**
 * 呼ばれるたびに保留の Promise を返す fetch のモック。`init.signal` が abort されると `AbortError` で reject する
 * （本物の fetch と同じ）。`calls` に呼ばれた順で入る
 */
export const mockFetchPending = () => {
  const calls: PendingFetch[] = [];
  const spy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal ?? undefined;
        const call: PendingFetch = {
          url: String(input),
          init,
          respond: (r) => resolve(createResponse(r)),
          fail: reject,
          get aborted() {
            return signal?.aborted ?? false;
          },
        };
        calls.push(call);
        if (signal?.aborted) {
          reject(createAbortError());
          return;
        }
        signal?.addEventListener('abort', () => reject(createAbortError()));
      });
    });
  return { spy, calls };
};

/**
 * URL ごとに応答を返す fetch のモック。`routes` のキーが URL に含まれれば、その応答を返す（先に書いたものが優先）。
 * どれにも当たらなければ reject する（実ストアにアクセスしないため）
 */
export const mockFetchRoutes = (
  routes: Record<string, MockResponseInit | (() => MockResponseInit)>
) =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    for (const [part, response] of Object.entries(routes)) {
      if (url.includes(part)) {
        return createResponse(
          typeof response === 'function' ? response() : response
        );
      }
    }
    throw new Error(`unmocked fetch: ${url}`);
  });

/** spy の n 回目の呼び出しの URL と init（リクエストの検証用） */
export const requestOf = (spy: jest.SpyInstance, index = 0) => {
  const call = spy.mock.calls[index] as [unknown, RequestInit | undefined];
  if (!call) {
    throw new Error(`fetch was not called ${index + 1} time(s)`);
  }
  return { url: String(call[0]), init: call[1] };
};
