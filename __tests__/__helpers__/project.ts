// CLI のテスト用に、node_modules を持つアプリのディレクトリを一時ディレクトリ（os.tmpdir）に組み立てる。
// リポジトリの中に作ると、解決が親の node_modules（このリポジトリの依存）まで辿って結果が変わるため、外に置く
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** node_modules/<name>/package.json に書く中身 */
export type FakePackage = Record<string, unknown>;

export type Project = {
  /** アプリのディレクトリ（絶対パス） */
  dir: string;
  /** node_modules/<name> にパッケージを置く */
  install: (name: string, pkg: FakePackage) => void;
  /** アプリのディレクトリからの相対パスにファイルを書く（親のディレクトリも作る） */
  write: (path: string, content: string) => void;
  /** `__tests__/__fixtures__/cli/<name>/` の中身をアプリのディレクトリに写す */
  copyFixture: (name: string) => void;
  /** 片付け（afterEach で呼ぶ） */
  remove: () => void;
};

/**
 * tmpdir とその親に node_modules が無いこと。あると、組み立てたアプリから親へ辿る探し方（src/cli/packages.ts）が
 * そこのパッケージを拾い、「見つからない」のテストが環境によって変わってしまう
 */
const assertNoParentNodeModules = (dir: string) => {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules'))) {
      throw new Error(
        `${join(current, 'node_modules')} exists above the temporary directory; the CLI tests need a tmpdir without node_modules in its parents`
      );
    }
    if (dirname(current) === current) {
      return;
    }
  }
};

export const createProject = (
  packages: Record<string, FakePackage> = {}
): Project => {
  assertNoParentNodeModules(tmpdir());
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
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const copyFixture = (name: string) => {
    cpSync(join(__dirname, '..', '__fixtures__', 'cli', name), dir, {
      recursive: true,
    });
  };
  return {
    dir,
    install,
    write,
    copyFixture,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};

/**
 * `expo/config` の代わり（getConfig）。本物（@expo/config）と同じく、app.json の `expo` を基に app.config.js があれば
 * それを評価し、`{ exp, staticConfigPath, dynamicConfigPath }` を返す。CLI が渡すオプションも確かめる
 */
export const FAKE_EXPO_CONFIG = `const fs = require('node:fs');
const path = require('node:path');
exports.getConfig = (projectRoot, options) => {
  if (!options || options.skipSDKVersionRequirement !== true) {
    throw new Error('skipSDKVersionRequirement is not set');
  }
  const staticConfigPath = path.join(projectRoot, 'app.json');
  const json = fs.existsSync(staticConfigPath)
    ? JSON.parse(fs.readFileSync(staticConfigPath, 'utf8'))
    : {};
  const config = json.expo ?? json;
  const dynamicConfigPath = path.join(projectRoot, 'app.config.js');
  if (!fs.existsSync(dynamicConfigPath)) {
    return { exp: config, staticConfigPath, dynamicConfigPath: null };
  }
  const exported = require(dynamicConfigPath);
  const exp = typeof exported === 'function' ? exported({ config }) : exported;
  return { exp, staticConfigPath, dynamicConfigPath };
};
`;

/** node_modules/expo を置き、`expo/config`（node_modules/expo/config.js）を `source` にする */
export const installExpo = (
  project: Project,
  source: string = FAKE_EXPO_CONFIG
): void => {
  project.install('expo', { name: 'expo', version: '58.0.0' });
  project.write(join('node_modules', 'expo', 'config.js'), source);
};
