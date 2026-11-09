#!/usr/bin/env node
// CLI の入口（package.json の bin。Node 専用で、アプリのバンドルには入らない。exports からは辿れない）。
// ここでは Node の版だけを確かめ、満たすときだけ本体（main.ts）を読み込む。ESM の static import は巻き上げられて
// この判定より先に評価される（古い Node では本体が使う API の読み込みで先に落ちうる）ので、ほかのモジュールを
// static に import しない（__tests__/cli/index.test.ts でソースを読んで確かめている）

/** CLI が動く Node の最低の版（package.json の engines には書かない。D36 ③） */
export const MIN_NODE_VERSION = '22.14.0';

/**
 * `process.versions.node`（`22.14.0` など）が {@link MIN_NODE_VERSION} 以上か。major / minor だけを見る。
 * 比較のモジュールも import しないため、手で分ける。読めない値は満たさない扱い
 */
export const isSupportedNode = (version: string): boolean => {
  const [major, minor] = version.split('.').map((part) => Number(part));
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return false;
  }
  return major > 22 || (major === 22 && minor >= 14);
};

const start = async (): Promise<void> => {
  const current = process.versions.node;
  if (!isSupportedNode(current)) {
    process.stderr.write(
      `react-native-store-version: the CLI requires Node.js ${MIN_NODE_VERSION} or later (current: ${current})\n`
    );
    process.exitCode = 1;
    return;
  }
  const { main } = await import('./main.ts');
  await main();
};

// main() は自分で失敗を受けて終了コードにするので、ここに来るのは本体の読み込みの失敗だけ
start().catch((error: unknown) => {
  process.stderr.write(
    `react-native-store-version: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
