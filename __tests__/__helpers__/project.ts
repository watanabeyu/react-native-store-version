// CLI のテスト用に、node_modules を持つアプリのディレクトリを一時ディレクトリ（os.tmpdir）に組み立てる。
// リポジトリの中に作ると、解決が親の node_modules（このリポジトリの依存）まで辿って結果が変わるため、外に置く
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** node_modules/<name>/package.json に書く中身 */
export type FakePackage = Record<string, unknown>;

export type Project = {
  /** アプリのディレクトリ（絶対パス） */
  dir: string;
  /** node_modules/<name> にパッケージを置く */
  install: (name: string, pkg: FakePackage) => void;
  /** 片付け（afterEach で呼ぶ） */
  remove: () => void;
};

export const createProject = (
  packages: Record<string, FakePackage> = {}
): Project => {
  const dir = mkdtempSync(join(tmpdir(), 'rnsv-cli-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'app', private: true })
  );
  const install = (name: string, pkg: FakePackage) => {
    const pkgDir = join(dir, 'node_modules', name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg));
  };
  for (const [name, pkg] of Object.entries(packages)) {
    install(name, pkg);
  }
  return {
    dir,
    install,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};
