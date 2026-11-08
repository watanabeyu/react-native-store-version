// console.error / console.warn が出たらテストを失敗させる（意図しない警告を見逃さないため）。
// 出ることを検証したいテストは、そのテスト内で自分で jest.spyOn(console, 'error').mockImplementation() する
let spies: jest.SpyInstance[] = [];
const messages: string[] = [];

beforeEach(() => {
  messages.length = 0;
  spies = (['error', 'warn'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      messages.push(`console.${method}: ${args.map(String).join(' ')}`);
    })
  );
});

afterEach(() => {
  for (const spy of spies) {
    spy.mockRestore();
  }
  if (messages.length > 0) {
    throw new Error(`Unexpected console output:\n${messages.join('\n')}`);
  }
});
