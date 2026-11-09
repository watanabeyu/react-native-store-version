/**
 * @jest-environment node
 */
// CLI の入口（src/cli/index.ts）: Node の版の判定と、満たさないときに本体を読み込まずに終わること。
// 満たすときの本体の読み込み（`await import('./main.ts')`）は Jest では確かめられない（Jest の CJS の実行では dynamic import に
// --experimental-vm-modules が要り、babel の RN preset も import() を変換しない）。本体の動作は main.test.ts で run() / main() を直接見て、
// 入口からの起動は `pnpm build` の後の `node dist/cli/index.js check` で確かめる
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const loadIndex = () => {
  let mod: typeof import('../../src/cli/index.ts') | undefined;
  jest.isolateModules(() => {
    mod = require('../../src/cli/index.ts');
  });
  return mod as typeof import('../../src/cli/index.ts');
};

// index.ts の start() は読み込まれた時点で走る。その完了を待つ（本体の読み込みに進んでいれば、Jest ではその失敗が stderr に出る）
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// process.versions は書き込めない（writable: false）ので jest.replaceProperty は戻すときに失敗する。defineProperty で差し替えて戻す
const versionsDescriptor = Object.getOwnPropertyDescriptor(
  process,
  'versions'
) as PropertyDescriptor;
const withNodeVersion = (node: string) => {
  Object.defineProperty(process, 'versions', {
    ...versionsDescriptor,
    value: { ...process.versions, node },
  });
};

describe('src/cli/index.ts', () => {
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    Object.defineProperty(process, 'versions', versionsDescriptor);
    // Jest の process は本物の process の写しだが、exitCode のアクセサは本物につながっている（Jest 自体の終了コードになる）
    process.exitCode = undefined;
  });

  describe('isSupportedNode', () => {
    it.each([
      ['22.14.0', true],
      ['22.14.1', true],
      ['22.20.0', true],
      ['23.0.0', true],
      ['24.0.0', true],
      ['26.1.0', true],
      ['22.13.9', false],
      ['22.9.0', false],
      ['21.99.0', false],
      ['18.18.2', false],
      ['', false],
      ['v22.14.0', false],
      ['22', false],
    ])('%j → %s', (version, expected) => {
      // 読み込むと start() が走る。本体の dynamic import に進まない（同期的に終わる）よう、古い版にしてから読む
      withNodeVersion('18.0.0');
      expect(loadIndex().isSupportedNode(version)).toBe(expected);
    });
  });

  it('exits with 1 and the required version without loading main() on older Node', async () => {
    withNodeVersion('22.13.1');
    loadIndex();
    await settle();
    expect(stderr.mock.calls).toEqual([
      [
        'react-native-store-version: the CLI requires Node.js 22.14.0 or later (current: 22.13.1)\n',
      ],
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('has the shebang first and imports nothing statically (static imports are hoisted above the version check)', () => {
    const source = readFileSync(
      join(__dirname, '../../src/cli/index.ts'),
      'utf8'
    );
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/^\s*(import|export)\b[^(]*\bfrom\b/m);
    expect(code).not.toMatch(/^\s*import\s*['"]/m);
    expect(code).not.toMatch(/\brequire\(/);
    expect([...code.matchAll(/\bimport\(([^)]*)\)/g)].map((m) => m[1])).toEqual(
      ["'./main.ts'"]
    );
  });
});
