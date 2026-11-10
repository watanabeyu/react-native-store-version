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
 * `expo/config` の代わり（getConfig）。本物（@expo/config 58 の build/Config.js）の形に寄せている:
 * - `<projectRoot>/package.json` が無ければ throw（getRootPackageJsonPath）
 * - 静的な設定は app.json（無ければ `staticConfigPath: null`）。`rootConfig` はその生の中身（無ければ `{}`）
 * - app.config.js があれば、既定値を埋めた静的な設定を `config` に渡して評価し、`{ expo: {...} }` を返したら中身を取り出す
 * - `exp.version` を `exp.version ?? package.json の version ?? '1.0.0'` で埋める（ensureConfigHasDefaultValues）
 * CLI が渡すオプションも確かめる
 */
export const FAKE_EXPO_CONFIG = `const fs = require('node:fs');
const path = require('node:path');
exports.getConfig = (projectRoot, options) => {
  if (!options || options.skipSDKVersionRequirement !== true) {
    throw new Error('skipSDKVersionRequirement is not set');
  }
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('The expected package.json path: ' + packageJsonPath + ' does not exist');
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const withDefaults = (exp) => ({
    ...exp,
    version: exp.version ?? (typeof pkg.version === 'string' ? pkg.version : '1.0.0'),
  });
  const reduce = (config) => (config && (config.expo ?? config)) || {};
  const appJson = path.join(projectRoot, 'app.json');
  const staticConfigPath = fs.existsSync(appJson) ? appJson : null;
  const rawStaticConfig = staticConfigPath
    ? JSON.parse(fs.readFileSync(staticConfigPath, 'utf8'))
    : null;
  const rootConfig = rawStaticConfig || {};
  const appConfig = path.join(projectRoot, 'app.config.js');
  const dynamicConfigPath = fs.existsSync(appConfig) ? appConfig : null;
  let exp = reduce(rawStaticConfig);
  if (dynamicConfigPath) {
    const exported = require(dynamicConfigPath);
    exp = reduce(
      typeof exported === 'function'
        ? exported({ config: withDefaults(exp) })
        : exported
    );
  }
  return {
    exp: withDefaults(exp),
    rootConfig,
    staticConfigPath,
    dynamicConfigPath,
  };
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
