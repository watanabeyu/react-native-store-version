// 全テスト共通の setup（jest.setupFilesAfterEnv）。
//
// 1. console.error / console.warn が出たらテストを失敗させる（意図しない警告を見逃さないため）。
//    jest.spyOn ではなくトップレベルでの直接の差し替えにしている。jest.restoreMocks（restoreAllMocks）は
//    spy しか元に戻さないので、これなら外れない。出ることを検証したいテストは、そのテスト内で
//    自分で jest.spyOn(console, 'error').mockImplementation() する（restoreMocks は各テストの前に走るので、
//    次のテストの前にここの差し替えに戻る。beforeAll で張った spy は最初のテストの前に外れる点に注意）
// 2. fetch を既定で失敗させる。モックし忘れたテストが実ストアにアクセスしないようにするため。
//    ヘルパー（__helpers__/fetch.ts）や各テストの jest.spyOn(globalThis, 'fetch') で上書きできる
//    （同じ spy が再利用され、mockResolvedValue などで既定を置き換える）。restoreMocks: true により各テストの前に外れ、下の beforeEach で張り直される
// 3. 偽のタイマー（jest.useFakeTimers）が残っていたら失敗にして、各テストの後に本物に戻す（下の afterEach）
// 4. unhandled rejection はそのテストの失敗にする（package.json の jest.waitForUnhandledRejections: true。Jest 30 の設定）
// 5. 例外: React 19 の findNodeHandle の StrictMode 非推奨警告（jest のモックの View で出る 1 通り）だけは無視する（下の IGNORED）
// 6. テストの時間の上限は 20 秒（package.json の jest.testTimeout）。CI ではキャッシュの無い状態で並列に動き、UI のテストの
//    最初の 1 本が RN の Modal / Animated / ScrollView を初めて読み込んで変換する分で、既定の 5 秒を超えることがあるため
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

// 無視する警告（テスト環境のモックが原因で出るもの。実機では出ない）:
// - React 19 の findNodeHandle の StrictMode 非推奨警告。テストが <StrictMode> で囲み、その中でデフォルト UI の Modal が出たときだけ出る。
//   RN の Animated（native driver）は Animated.View の中の View に findNodeHandle を呼ぶが、React が警告するのはクラスコンポーネントの
//   インスタンスを渡されたときだけで、@react-native/jest-preset が View をクラスのモックにしているために出る
//   （実機の View はホストコンポーネントなので出ない）。React は 1 ファイル・コンポーネント名ごとに 1 回だけ出す。
//   React は %s をフォーマットせずに引数を並べて渡すので、実際の引数の並び（… findNodeHandle findNodeHandle View）に合わせた 1 通りだけに絞る
const IGNORED = [
  /^%s is deprecated in StrictMode\. %s was passed an instance of %s which is inside StrictMode\. Instead, add a ref directly to the element you want to reference\. Learn more about using refs safely here: https:\/\/react\.dev\/link\/strict-mode-find-node findNodeHandle findNodeHandle View$/,
];

for (const method of ['error', 'warn'] as const) {
  console[method] = (...args: unknown[]) => {
    const text = args.map(format).join(' ');
    // React の %s はフォーマットしないので、引数を順に並べた文字列で判定する
    if (IGNORED.some((pattern) => pattern.test(text))) {
      return;
    }
    messages.push(`console.${method}: ${text}`);
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
  // package.json の jest.restoreMocks: true で各テストの前（この beforeEach より先）に spy が外れるので、テストごとに張り直す
  // （messages はここで消さない。読み込み時・describe 直下・beforeAll で出た分を最初の afterEach で失敗にするため）
  jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('unmocked fetch'));
});

afterEach(flush);

// jest.useFakeTimers() を使ったテストの後始末。タイマーが残っていたら失敗にしてから（完了時にタイマーを解除し忘れた
// src の不具合や、片付けていないテストを見逃さないため）、偽の時計を捨てて次のテストを本物のタイマーに戻す
// （useRealTimers を書き忘れても、次のテストの await が止まらないようにする）。意図して残すテストは、そのテストの中で
// jest.clearAllTimers() する。偽のタイマーかどうかは、@sinonjs/fake-timers が差し替えた setTimeout に付ける `clock` で見る
// （jest.getTimerCount() は本物のタイマーのときに console.warn を出すので、先に確かめる）
const usingFakeTimers = () => 'clock' in globalThis.setTimeout;

afterEach(() => {
  try {
    if (usingFakeTimers()) {
      const count = jest.getTimerCount();
      if (count !== 0) {
        throw new Error(
          `${count} fake timer(s) left after the test. Clear them in the test with jest.clearAllTimers() if intended`
        );
      }
    }
  } finally {
    jest.useRealTimers();
  }
});

// describe 直下や beforeAll で出た分は beforeEach で消さないので、最初の afterEach で拾える。ここで拾えるのは、この afterAll より先に
// 実行される分まで（テストファイル自身の afterAll で出した分は、この後に実行されるので拾えない）
afterAll(flush);
