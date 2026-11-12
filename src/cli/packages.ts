// `<cwd>` から見たパッケージの探し方。アプリ（Metro）と同じく、`<cwd>` から親へ辿った各ディレクトリの node_modules/<name> を見る
// （monorepo の巻き上げも拾う）。
//
// createRequire の require.resolve は使わない。Node の解決は node_modules の連鎖のほかに NODE_PATH と
// グローバルのフォルダ（~/.node_modules など）も見るが、pnpm の bin の shim は NODE_PATH に node_modules/.pnpm/node_modules
// （巻き上げた推移的な依存）や、この CLI 自身のパッケージがある node_modules/.pnpm/react-native-store-version@x/node_modules を
// 入れて起動する。そのため `pnpm exec` / `pnpm dlx` から動かすと、アプリに入っていないパッケージ（この CLI 自身を含む）も
// 見つかってしまう。Metro は NODE_PATH を見ないので、ここも見ない
import { statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * `<cwd>` から親へ辿り、最初に見つかった `node_modules/<name>/package.json` のパス（symlink は辿らないままのパス）。
 * 無ければ null。Node と同じく、`node_modules` という名前のディレクトリの下に node_modules は探さない
 */
export const findPackageJson = (cwd: string, name: string): string | null => {
  let dir = resolve(cwd);
  for (;;) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', name, 'package.json');
      if (isFile(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

/** `<cwd>` から `name` のパッケージが見つかるか（{@link findPackageJson}） */
export const isInstalled = (cwd: string, name: string): boolean =>
  findPackageJson(cwd, name) !== null;
