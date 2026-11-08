// 全テスト共通の setup（jest.setupFilesAfterEnv）。
//
// 1. console.error / console.warn が出たらテストを失敗させる（意図しない警告を見逃さないため）。
//    jest.spyOn ではなくトップレベルでの直接の差し替えにしている。各テストファイルの jest.restoreAllMocks() は
//    spy しか元に戻さないので、これなら外れない。出ることを検証したいテストは、そのテスト内で
//    自分で jest.spyOn(console, 'error').mockImplementation() する（restoreAllMocks でここの差し替えに戻る）
// 2. fetch を既定で失敗させる。モックし忘れたテストが実ストアにアクセスしないようにするため。
//    ヘルパー（__helpers__/fetch.ts）や各テストの jest.spyOn(globalThis, 'fetch') で上書きできる
//    （同じ spy が再利用され、mockResolvedValue などで既定を置き換える）
const messages: string[] = [];

const format = (arg: unknown): string => {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    // JSON.stringify は undefined / function / symbol で undefined を返す
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    // 循環参照や BigInt など
    return String(arg);
  }
};

for (const method of ['error', 'warn'] as const) {
  console[method] = (...args: unknown[]) => {
    messages.push(`console.${method}: ${args.map(format).join(' ')}`);
  };
}

const flush = () => {
  if (messages.length > 0) {
    const text = messages.join('\n');
    messages.length = 0;
    throw new Error(`Unexpected console output:\n${text}`);
  }
};

beforeEach(() => {
  messages.length = 0;
  // 各ファイルの afterEach の jest.restoreAllMocks() で元の fetch に戻るので、テストごとに張り直す
  jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('unmocked fetch'));
});

afterEach(flush);

// describe 直下や beforeAll で出た分も、最初の afterEach で拾える。ここで拾えるのは、この afterAll より先に
// 実行される分まで（テストファイル自身の afterAll で出した分は、この後に実行されるので拾えない）
afterAll(flush);
