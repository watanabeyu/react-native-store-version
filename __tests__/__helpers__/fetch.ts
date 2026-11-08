// global.fetch を差し替えて、実ストアにアクセスせず fixture を返すヘルパー（RN の jest setup は fetch をモックしない）。
// src は ios が `.text()`、android が `.status` と `.text()` だけを使う。
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
