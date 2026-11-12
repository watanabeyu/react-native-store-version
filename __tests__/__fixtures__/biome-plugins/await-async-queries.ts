// biome-plugins/await-async-queries.grit（U5）の回帰テストの入力（__tests__/biome-plugins/await-async-queries.test.ts が lint する）。
// 通常の lint の対象外（biome.json の files.includes で __tests__/__fixtures__ を外している）。
// 診断が出るべき行の末尾に `// detect`、出てはいけない行に `// ok` を書く（テストはこの印から期待値を作る）
declare const screen: any;
declare const render: any;
declare const act: any;
declare const expect: any;
declare const waitFor: any;
declare const waitForElementToBeRemoved: any;
declare const waitForIt: any;
declare const findByText: any;

export async function detected() {
  findByText('bare'); // detect
  waitFor(() => 1); // detect
  waitForElementToBeRemoved(() => 1); // detect
  screen.findByText('member'); // detect
  screen.findAllByText('member'); // detect
  render(null).findByRole('button'); // detect
  screen.findByRole('button', { name: 'multiple args' }); // detect
  waitFor(() => 1, { timeout: 10 }); // detect
  await act(async () => {
    screen.findByText('inside act'); // detect
  });
  await waitFor(() => {
    screen.findByText('inside waitFor'); // detect
  });
  expect(screen.findByText('not awaited expect')).resolves.toBeTruthy(); // detect
  void screen.findByText('void'); // detect
}

export const objectWithMethod = {
  async method() {
    screen.findByText('object method'); // detect
  },
};

export class WithMethod {
  async method() {
    screen.findByText('class method'); // detect
  }
}

export async function notDetected() {
  await screen.findByText('awaited'); // ok
  await waitFor(() => 1); // ok
  await expect(screen.findByText('awaited expect')).resolves.toBeTruthy(); // ok
  await Promise.all([screen.findByText('a'), screen.findAllByText('b')]); // ok
  await expect(() => waitFor(() => 1)).rejects.toThrow(); // ok
  await act(async () => {
    await screen.findByText('awaited inside act'); // ok
  });
  waitForIt(); // ok
  screen.getByText('sync query'); // ok
  screen.queryByText('sync query'); // ok
  return screen.findByText('returned'); // ok
}

export const expressionBody = () => waitFor(() => 1); // ok
export const returned = async () => {
  return screen.findAllByText('returned'); // ok
};
