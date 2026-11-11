// @ts-check
// リリースの判定（npm に出すか・どの版で出すか・draft の Release のノートをどこから作るか）を、渡された値だけで行う。
// release.yml（master への push）と pr.yml（version の確認）から呼ぶ。
// npm view と git はネットワークに出るので workflow 側で実行し、その出力をファイルで渡す
// （publish を決める判定を、ネットワークなしの Jest で確かめられるようにするため）。
// Node の標準モジュールだけを使う（依存の install なしで動かす）。package.json の "type": "module" で ESM として動く。
//
// usage: node .github/scripts/release-version.js <command> --<name> <file> ...
//   changed --files <F> --base-package <F> --head-package <F>
//     配布物の変更があるか。files は `git diff --name-only -z --no-renames <base> <head>` の出力、
//     base-package / head-package はそれぞれの package.json。stdout に `changed=true|false`
//   check --package <F> --versions <F> --latest <F>
//     version が X.Y.Z の形で、npm に未公開で、dist-tags.latest より新しいか（pr.yml）。違えば終了コード 1。
//     versions は `npm view react-native-store-version versions --json`、latest は
//     `npm view react-native-store-version dist-tags.latest` の出力（どちらも未公開（E404）なら空のファイル）
//   plan --package <F> --versions <F> --tags <F> --changed <true|false>
//     master への push で beta と draft を作るか（release.yml）。tags は `git ls-remote --tags --refs origin` の出力。
//     stdout に beta / beta-version / draft / draft-version / notes-start-tag
// stdout には `key=value` の行だけを出す（workflow が GITHUB_OUTPUT に足す）。説明・警告・エラーは stderr に出す。
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

/** 正式版の version（プレリリース・ビルドメタデータを含まない）。グループは X / Y / Z */
export const STABLE_VERSION = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;

/** beta の version。release.yml のタグのジョブも同じ正規表現で確かめる */
export const BETA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$/;

/** npm の dist-tags.latest として受け付ける形（semver の正式版かプレリリース） */
const LATEST_VERSION =
  /^([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** 前の正式版のタグ（v1 / v2 の major タグや beta のタグは起点にしない） */
const RELEASE_TAG = /^v([0-9]+)\.([0-9]+)\.([0-9]+)$/;

/**
 * 変わると配布物が変わるディレクトリ（npm の配布物と、major タグで利用者に届く action.yml）。
 * README.md / CHANGELOG.md も npm の配布物に入るが、文書だけの変更で beta を刻まないよう対象にしない
 */
const PACKAGE_DIRECTORIES = ['src/', 'texts/'];

/** 変わると配布物が変わるファイル */
const PACKAGE_FILES = ['action.yml'];

/**
 * 変わると配布物（の入口・依存）が変わる package.json の項目。devDependencies・scripts・packageManager などだけの変更
 * （Dependabot の更新など）は配布物の変更として扱わない
 */
export const PACKAGE_FIELDS = [
  'version',
  'type',
  'exports',
  'files',
  'main',
  'types',
  'bin',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
];

/**
 * @typedef {Record<string, unknown>} PackageJson
 */

/**
 * 配布物に入るファイルか
 * @param {string} path リポジトリのルートからの相対パス（`/` 区切り）
 * @returns {boolean}
 */
export const isPackageFile = (path) =>
  PACKAGE_DIRECTORIES.some((directory) => path.startsWith(directory)) ||
  PACKAGE_FILES.includes(path);

/**
 * base と head で値が違う PACKAGE_FIELDS の項目。exports の条件の順番のように順序に意味がある値があるので、
 * キーの順番の違いも変更として扱う（並べ替えただけでも beta が出るが、見逃すより安全）
 * @param {PackageJson} basePackage
 * @param {PackageJson} headPackage
 * @returns {string[]}
 */
export const changedPackageFields = (basePackage, headPackage) =>
  PACKAGE_FIELDS.filter(
    (field) =>
      JSON.stringify(basePackage[field]) !== JSON.stringify(headPackage[field])
  );

/**
 * 配布物の変更があるか
 * @param {{ files: string[], basePackage: PackageJson, headPackage: PackageJson }} input
 * @returns {{ changed: boolean, files: string[], fields: string[] }} files / fields は変更の理由（ログ用）
 */
export const detectPackageChange = ({ files, basePackage, headPackage }) => {
  const changedFiles = files.filter(isPackageFile);
  const fields = changedPackageFields(basePackage, headPackage);
  return {
    changed: changedFiles.length > 0 || fields.length > 0,
    files: changedFiles,
    fields,
  };
};

/**
 * `git diff --name-only -z` の出力を読む（改行区切りも受け付ける）
 * @param {string} text
 * @returns {string[]}
 */
export const parseFileList = (text) =>
  text.split(/[\0\n]/).filter((path) => path !== '');

/**
 * `npm view <pkg> versions --json` の出力を読む。版が 1 つだけのときは配列ではなく文字列が返る。
 * 空（未公開で E404 のとき、workflow が空のファイルを渡す）なら []
 * @param {string} text
 * @returns {string[]}
 */
export const parseVersions = (text) => {
  if (text.trim() === '') {
    return [];
  }
  /** @type {unknown} */
  const value = JSON.parse(text);
  const versions = typeof value === 'string' ? [value] : value;
  if (
    !Array.isArray(versions) ||
    !versions.every((version) => typeof version === 'string')
  ) {
    throw new Error(
      `unexpected output of npm view versions: ${text.trim().slice(0, 200)}`
    );
  }
  return versions;
};

/**
 * `npm view <pkg> dist-tags.latest` の出力を読む。空（未公開）なら null。
 * 想定外の形なら止める（latest との比較を誤って通さないため）
 * @param {string} text
 * @returns {string | null}
 */
export const parseLatest = (text) => {
  const latest = text.trim();
  if (latest === '') {
    return null;
  }
  if (!LATEST_VERSION.test(latest)) {
    throw new Error(`unexpected dist-tags.latest: '${latest.slice(0, 200)}'`);
  }
  return latest;
};

/**
 * `git ls-remote --tags --refs` の出力（`<sha>\trefs/tags/<name>`）からタグ名を取り出す。タグ名だけの行も受け付ける
 * @param {string} text
 * @returns {string[]}
 */
export const parseTags = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const ref = line.split('\t').at(-1) ?? '';
      return ref.startsWith('refs/tags/')
        ? ref.slice('refs/tags/'.length)
        : ref;
    });

/**
 * X.Y.Z の 3 つの数（大きな数でも桁を失わないよう BigInt で比べる）
 * @param {RegExpMatchArray} match 1〜3 番目のグループが数字
 * @returns {bigint[]}
 */
const numbersOf = (match) => [
  BigInt(match[1]),
  BigInt(match[2]),
  BigInt(match[3]),
];

/**
 * @param {bigint[]} a
 * @param {bigint[]} b
 * @returns {number} a が大きければ正、小さければ負、同じなら 0
 */
const compareNumbers = (a, b) => {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] > b[i] ? 1 : -1;
    }
  }
  return 0;
};

/**
 * 正式版の version が latest より新しいか。X.Y.Z が同じで latest がプレリリースなら、正式版の方が新しい
 * @param {string} version STABLE_VERSION に合うこと
 * @param {string} latest LATEST_VERSION に合うこと
 * @returns {boolean}
 */
export const isNewerThan = (version, latest) => {
  const versionMatch = version.match(STABLE_VERSION);
  const latestMatch = latest.match(LATEST_VERSION);
  if (!versionMatch || !latestMatch) {
    throw new Error(`cannot compare '${version}' with '${latest}'`);
  }
  const order = compareNumbers(numbersOf(versionMatch), numbersOf(latestMatch));
  return order > 0 || (order === 0 && latestMatch[4] !== undefined);
};

/**
 * version を新しく publish できるか（pr.yml の確認）。X.Y.Z の形で、npm に未公開で、latest より新しいこと
 * @param {{ version: unknown, versions: string[], latest: string | null }} input
 * @returns {{ ok: true } | { ok: false, reason: 'invalid' | 'published' | 'not-newer', message: string }}
 */
export const checkNewVersion = ({ version, versions, latest }) => {
  if (typeof version !== 'string' || !STABLE_VERSION.test(version)) {
    return {
      ok: false,
      reason: 'invalid',
      message: `package.json version (${String(version)}) is not X.Y.Z; set the version to release (prereleases are published by the release workflow)`,
    };
  }
  if (versions.includes(version)) {
    return {
      ok: false,
      reason: 'published',
      message: `${version} is already published to npm; bump the version in package.json`,
    };
  }
  if (latest !== null && !isNewerThan(version, latest)) {
    return {
      ok: false,
      reason: 'not-newer',
      message: `${version} is not newer than dist-tags.latest (${latest}); bump the version in package.json`,
    };
  }
  return { ok: true };
};

/**
 * 次の beta の version（`X.Y.Z-beta.N`）。N は npm に出ている `X.Y.Z-beta.<数字>` の最大 + 1（無ければ 1）。
 * 番号は文字列ではなく数として比べる（beta.10 > beta.9）。`-beta.x` などの形は数えない
 * @param {string} version STABLE_VERSION に合うこと
 * @param {string[]} versions npm に出ている版
 * @returns {string}
 */
export const nextBetaVersion = (version, versions) => {
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`version (${version}) is not X.Y.Z`);
  }
  const prefix = `${version}-beta.`;
  let highest = 0n;
  for (const published of versions) {
    if (!published.startsWith(prefix)) {
      continue;
    }
    const number = published.slice(prefix.length);
    if (/^[0-9]+$/.test(number) && BigInt(number) > highest) {
      highest = BigInt(number);
    }
  }
  return `${prefix}${highest + 1n}`;
};

/**
 * draft の Release のノートの起点（version より前の正式版のうち最新のタグ）。無ければ null（最初からのノートになる）。
 * beta のタグや major タグは起点にしない（ノートを前の正式版からの変更にするため）
 * @param {string} version STABLE_VERSION に合うこと
 * @param {string[]} tags リポジトリのタグ名
 * @returns {string | null}
 */
export const previousReleaseTag = (version, tags) => {
  const versionMatch = version.match(STABLE_VERSION);
  if (!versionMatch) {
    throw new Error(`version (${version}) is not X.Y.Z`);
  }
  const current = numbersOf(versionMatch);
  /** @type {{ tag: string, numbers: bigint[] } | null} */
  let previous = null;
  for (const tag of tags) {
    const match = tag.match(RELEASE_TAG);
    if (!match) {
      continue;
    }
    const numbers = numbersOf(match);
    if (
      compareNumbers(numbers, current) < 0 &&
      (previous === null || compareNumbers(numbers, previous.numbers) > 0)
    ) {
      previous = { tag, numbers };
    }
  }
  return previous?.tag ?? null;
};

/**
 * master への push で何を作るか（release.yml）。
 * - version が X.Y.Z でなければ止める（throw）
 * - npm に既に出ている version なら、beta も draft も作らない（pr.yml の確認をすり抜けた場合の保険。警告だけ出す）
 * - それ以外は draft を作り、配布物の変更があれば beta も出す
 * @param {{ version: unknown, versions: string[], tags: string[], changed: boolean }} input
 * @returns {{ outputs: Record<string, string>, warning: string | null }}
 */
export const planPush = ({ version, versions, tags, changed }) => {
  if (typeof version !== 'string' || !STABLE_VERSION.test(version)) {
    throw new Error(
      `package.json version (${String(version)}) is not X.Y.Z; the release workflow adds the beta number itself`
    );
  }
  if (versions.includes(version)) {
    return {
      outputs: {
        beta: 'false',
        'beta-version': '',
        draft: 'false',
        'draft-version': '',
        'notes-start-tag': '',
      },
      warning: `${version} is already published to npm; no beta and no draft release are created. Bump the version in package.json`,
    };
  }
  return {
    outputs: {
      beta: String(changed),
      'beta-version': changed ? nextBetaVersion(version, versions) : '',
      draft: 'true',
      'draft-version': version,
      'notes-start-tag': previousReleaseTag(version, tags) ?? '',
    },
    warning: null,
  };
};

/** コマンドラインの入口で受け付けるオプション（すべてファイルのパスか true / false） */
const OPTIONS = /** @type {const} */ ({
  files: { type: 'string' },
  'base-package': { type: 'string' },
  'head-package': { type: 'string' },
  package: { type: 'string' },
  versions: { type: 'string' },
  latest: { type: 'string' },
  tags: { type: 'string' },
  changed: { type: 'string' },
});

/**
 * @param {Record<string, string | undefined>} values
 * @param {string} name
 * @returns {string}
 */
const requireOption = (values, name) => {
  const value = values[name];
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
};

/**
 * @param {Record<string, string | undefined>} values
 * @param {string} name
 * @returns {string}
 */
const readOption = (values, name) =>
  readFileSync(requireOption(values, name), 'utf8');

/**
 * @param {Record<string, string | undefined>} values
 * @param {string} name
 * @returns {PackageJson}
 */
const readPackage = (values, name) => {
  /** @type {unknown} */
  const value = JSON.parse(readOption(values, name));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`--${name} is not a package.json object`);
  }
  return /** @type {PackageJson} */ (value);
};

/**
 * @param {Record<string, string>} outputs
 * @returns {string}
 */
const formatOutputs = (outputs) =>
  Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');

/**
 * コマンドラインの入口。stdout に `key=value` の行、stderr に説明を出し、終了コードを返す
 * @param {string[]} argv `node release-version.js` より後ろの引数
 * @param {{ stdout: (text: string) => void, stderr: (text: string) => void }} io
 * @returns {number}
 */
export const main = (argv, io) => {
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    const [command, ...rest] = positionals;
    if (rest.length > 0) {
      throw new Error(`unexpected arguments: ${rest.join(' ')}`);
    }

    if (command === 'changed') {
      const result = detectPackageChange({
        files: parseFileList(readOption(values, 'files')),
        basePackage: readPackage(values, 'base-package'),
        headPackage: readPackage(values, 'head-package'),
      });
      io.stderr(
        result.changed
          ? `package changes: files [${result.files.join(', ')}], package.json fields [${result.fields.join(', ')}]\n`
          : 'no package changes\n'
      );
      io.stdout(formatOutputs({ changed: String(result.changed) }));
      return 0;
    }

    if (command === 'check') {
      const version = readPackage(values, 'package').version;
      const result = checkNewVersion({
        version,
        versions: parseVersions(readOption(values, 'versions')),
        latest: parseLatest(readOption(values, 'latest')),
      });
      if (!result.ok) {
        io.stderr(`::error::${result.message}\n`);
        return 1;
      }
      io.stderr(`${String(version)} is not published yet and is newer\n`);
      return 0;
    }

    if (command === 'plan') {
      const changed = requireOption(values, 'changed');
      if (changed !== 'true' && changed !== 'false') {
        throw new Error(`--changed must be true or false (got ${changed})`);
      }
      const { outputs, warning } = planPush({
        version: readPackage(values, 'package').version,
        versions: parseVersions(readOption(values, 'versions')),
        tags: parseTags(readOption(values, 'tags')),
        changed: changed === 'true',
      });
      if (warning !== null) {
        io.stderr(`::warning::${warning}\n`);
      }
      io.stdout(formatOutputs(outputs));
      return 0;
    }

    throw new Error(
      `unknown command: ${String(command)} (expected changed, check or plan)`
    );
  } catch (error) {
    io.stderr(
      `::error::${error instanceof Error ? error.message : String(error)}\n`
    );
    return 1;
  }
};

// `node .github/scripts/release-version.js` で実行されたときだけ入口を動かす（テストから import したときは動かさない）。
// import.meta.url と比べないのは、Jest がこのファイルを CommonJS に変換して読み、import.meta を使えないため
if (basename(process.argv[1] ?? '') === 'release-version.js') {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
