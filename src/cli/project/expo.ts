// Expo の設定（app.json / app.config.ts / app.config.js）から bundleIdentifier / package / version を読む（C2 / C4）。
// アプリに入っている `expo` の `expo/config`（@expo/config の再 export）の getConfig で評価する。pnpm の isolated では
// アプリから @expo/config を直接は解決できないので、expo のディレクトリを起点に読む。CLI のための依存は足さないので、
// 型は import せず、返ってきた値（unknown）から必要な形を確かめる
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { format } from 'node:util';

import { findPackageJson } from '../packages.ts';
import { displayPath, isFile, readText } from './files.ts';

/** Expo の設定から読んだ値。無い・文字列でないものは null */
export type ExpoConfig = {
  /** 値を読んだ設定ファイル（{@link displayPath}） */
  file: string;
  bundleIdentifier: string | null;
  package: string | null;
  version: string | null;
};

/**
 * `expo` が入っているアプリの設定。`config` は読めなかったら null。`notes` は C2 が info で出す注意
 * （getConfig が失敗して app.json の素読みに戻ったことなど）
 */
export type ExpoProject = {
  config: ExpoConfig | null;
  notes: string[];
};

type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** 失敗の理由を 1 行に詰めたときの長さの上限 */
const MAX_REASON = 300;

/**
 * 失敗の理由を 1 行にする。getConfig の失敗は `Error reading Expo config at <path>:` の次の行以降に理由があり、
 * 構文エラーではその後にコードの抜粋（`> 2 |   name: ,`）が続く。抜粋の手前までの空でない行をつなぎ、
 * `<cwd>/` を落として（パスは cwd からの相対で出す）、長すぎれば切る
 */
/**
 * Error の message。`instanceof Error` では見ない: アプリの設定の評価や、Jest のモジュールの解決が投げるものは
 * 別の realm の Error のことがあり、`String(error)` だと先頭に `Error: ` が付く
 */
const messageOf = (error: unknown): string =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : String(error);

const errorMessage = (error: unknown, cwd?: string) => {
  const lines: string[] = [];
  for (const line of messageOf(error).split(/\r?\n/)) {
    if (/^\s*>?\s*\d+\s*\|/.test(line)) {
      break;
    }
    if (line.trim() !== '') {
      lines.push(line.trim());
    }
  }
  let reason = lines.join(' ');
  if (cwd !== undefined) {
    reason = reason.split(`${cwd}${sep}`).join('');
  }
  return reason.length > MAX_REASON
    ? `${reason.slice(0, MAX_REASON)}…`
    : reason;
};

/** 設定の `expo` の中身（app.json の `expo` キーの下、または app.config の戻り値）から値を取る */
const valuesOf = (exp: Obj, file: string): ExpoConfig => {
  const ios = isObject(exp.ios) ? exp.ios : {};
  const android = isObject(exp.android) ? exp.android : {};
  return {
    file,
    bundleIdentifier: text(ios.bundleIdentifier),
    package: text(android.package),
    version: text(exp.version),
  };
};

/**
 * `fn` の間、stdout への出力を stderr に回す。getConfig はアプリの app.config.ts / .js を評価するので、そこの
 * `console.log` などが stdout に出ると `--json` の stdout が JSON でなくなる。
 * Node の console は書くたびに `process.stdout.write` を引くので、それを差し替えれば `console.log` も回る。
 * console 自体を差し替えたもの（Jest など）のために `console.log` / `info` / `debug` も回す。
 * getConfig は同期なので、戻ってから後に（タイマーなどで）出るものは回らない
 */
export const withStdoutToStderr = <T>(fn: () => T): T => {
  const { stdout, stderr } = process;
  const write = stdout.write;
  const { log, info, debug } = console;
  const toStderr = (...args: unknown[]) => {
    stderr.write(`${format(...args)}\n`);
  };
  stdout.write = stderr.write.bind(stderr) as typeof stdout.write;
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  try {
    return fn();
  } finally {
    stdout.write = write;
    console.log = log;
    console.info = info;
    console.debug = debug;
  }
};

/** 動的な設定（app.config.*）があればそれ、無ければ app.json のパス（getConfig の戻り値の名前） */
const configFileOf = (cwd: string, result: Obj): string => {
  const path = text(result.dynamicConfigPath) ?? text(result.staticConfigPath);
  return path === null ? 'the Expo config' : displayPath(cwd, path);
};

/**
 * getConfig の `exp.version` のうち、設定に書かれた値だけを返す（書かれていなければ null）。
 * getConfig（@expo/config の ensureConfigHasDefaultValues）は version が無いと `<cwd>/package.json` の version
 * （それも無ければ `1.0.0`）で埋めるので、bare RN に expo を入れただけのアプリ（app.json に version が無く、
 * package.json が `0.0.1`）でネイティブの版とのずれを誤って出してしまう。
 *
 * - 静的な設定の生の中身（`rootConfig`。`expo` キーの下か直下）に version があれば、書かれた値
 * - 動的な設定（app.config.*。`dynamicConfigPath`）があれば、`exp.version` が Expo の補う値（戻り値の `pkg.version`。
 *   getConfig は `pkg` にも同じ既定値を入れて返す）と違うときだけ書かれた値。app.config に渡す `config` も既定値を
 *   埋めた後のものなので、`({ config }) => ({ ...config, … })` は補った値をそのまま返すため
 *   限界: app.config に package.json と同じ値を明示したときは「書かれていない」と見なす（比べないだけで、誤った warning は出ない）
 * - どちらでもなければ書かれていない
 */
const writtenVersion = (result: Obj, version: string | null): string | null => {
  const root = isObject(result.rootConfig) ? result.rootConfig : {};
  const raw = isObject(root.expo) ? root.expo : root;
  if (text(raw.version) !== null) {
    return version;
  }
  if (text(result.dynamicConfigPath) === null) {
    return null;
  }
  const pkg = isObject(result.pkg) ? result.pkg : {};
  const filled = typeof pkg.version === 'string' ? pkg.version : '1.0.0';
  return version === filled ? null : version;
};

/**
 * 見つけた `expo` の `expo/config` を読み込む。createRequire の解決は NODE_PATH も見る（pnpm の bin の shim は
 * `.pnpm/node_modules` を入れる）ので、見つけた expo に `expo/config` が無いと別の expo のものを読みうる。
 * 解決した先が見つけた expo の中かを確かめる
 */
const loadExpoConfig = (cwd: string, expoPackageJson: string): unknown => {
  const require = createRequire(expoPackageJson);
  const resolved = require.resolve('expo/config');
  const expoDir = dirname(expoPackageJson);
  // expo の下の node_modules（入れ子の別の expo）も、見つけた expo のものではない
  const inside = relative(realpathSync(expoDir), realpathSync(resolved));
  if (inside.startsWith('..') || inside.split(sep).includes('node_modules')) {
    throw new Error(
      `${displayPath(cwd, expoDir)} does not provide expo/config`
    );
  }
  return require(resolved);
};

/** `expo/config` の getConfig で評価する。失敗は Error を投げる */
const evaluate = (cwd: string, expoPackageJson: string): ExpoConfig => {
  const result = withStdoutToStderr(() => {
    const mod = loadExpoConfig(cwd, expoPackageJson);
    const getConfig = isObject(mod) ? mod.getConfig : undefined;
    if (typeof getConfig !== 'function') {
      throw new Error('expo/config does not export getConfig');
    }
    return getConfig(cwd, { skipSDKVersionRequirement: true }) as unknown;
  });
  if (!isObject(result) || !isObject(result.exp)) {
    throw new Error('getConfig did not return { exp }');
  }
  const values = valuesOf(result.exp, configFileOf(cwd, result));
  return { ...values, version: writtenVersion(result, values.version) };
};

/** app.json を JSON として読む（`expo` キーがあればその下、無ければ直下）。無い・壊れていれば null と注意 */
const readAppJson = (
  cwd: string
): { config: ExpoConfig | null; note?: string } => {
  const path = join(cwd, 'app.json');
  if (!isFile(path)) {
    return { config: null, note: 'there is no app.json' };
  }
  let json: unknown;
  try {
    json = JSON.parse(readText(path) ?? '');
  } catch (error) {
    return {
      config: null,
      note: `could not parse app.json: ${errorMessage(error)}`,
    };
  }
  if (!isObject(json)) {
    return { config: null, note: 'app.json is not a JSON object' };
  }
  return {
    config: valuesOf(isObject(json.expo) ? json.expo : json, 'app.json'),
  };
};

/**
 * `<cwd>` から `expo` が見つからなければ null（Expo のアプリでない）。見つかれば getConfig で設定を評価し、
 * 失敗したら理由を notes に入れて app.json の素読みに戻る
 */
export const readExpoProject = (cwd: string): ExpoProject | null => {
  const expoPackageJson = findPackageJson(cwd, 'expo');
  if (expoPackageJson === null) {
    return null;
  }
  try {
    return { config: evaluate(cwd, expoPackageJson), notes: [] };
  } catch (error) {
    const fallback = readAppJson(cwd);
    return {
      config: fallback.config,
      notes: [
        `could not evaluate the Expo config with expo/config (${errorMessage(error, cwd)}); read app.json directly instead`,
        ...(fallback.note === undefined ? [] : [fallback.note]),
      ],
    };
  }
};
