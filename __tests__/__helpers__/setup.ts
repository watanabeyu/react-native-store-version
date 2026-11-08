// 全テスト共通の setup（jest.setupFilesAfterEnv）。
//
// 1. console.error / console.warn が出たらテストを失敗させる（意図しない警告を見逃さないため）。
//    jest.spyOn ではなくトップレベルでの直接の差し替えにしている。jest.restoreMocks（restoreAllMocks）は
//    spy しか元に戻さないので、これなら外れない。出ることを検証したいテストは、そのテスト内で
//    自分で jest.spyOn(console, 'error').mockImplementation() する（テスト後にここの差し替えに戻る）
// 2. fetch を既定で失敗させる。モックし忘れたテストが実ストアにアクセスしないようにするため。
//    ヘルパー（__helpers__/fetch.ts）や各テストの jest.spyOn(globalThis, 'fetch') で上書きできる
//    （同じ spy が再利用され、mockResolvedValue などで既定を置き換える）。restoreMocks: true により毎テスト作り直される
const messages: string[] = [];

const format = (arg: unknown): string => {
  // instanceof は別 realm（jest の vm context）の Error で外れるので toString で判定する
  if (Object.prototype.toString.call(arg) === '[object Error]') {
    const error = arg as Error;
    return error.stack ?? `${error.name}: ${error.message}`;
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
  // package.json の jest.restoreMocks: true で毎テスト後に spy が外れるので、テストごとに張り直す
  // （messages はここで消さない。読み込み時・describe 直下・beforeAll で出た分を最初の afterEach で失敗にするため）
  jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('unmocked fetch'));
});

afterEach(flush);

// describe 直下や beforeAll で出た分は beforeEach で消さないので、最初の afterEach で拾える。ここで拾えるのは、この afterAll より先に
// 実行される分まで（テストファイル自身の afterAll で出した分は、この後に実行されるので拾えない）
afterAll(flush);
