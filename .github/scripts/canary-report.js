// @ts-check
// canary（.github/scripts/canary.mjs）の、取得の結果を判定して報告の文面を作る部分。
// 副作用（fetch の差し替え・ファイルの読み書き・実ストアへの取得）は持たず、渡された値だけで動く
// （ネットワークなしの Jest で確かめられるようにするため。取得そのものは canary.mjs が行う）。
// Node の標準モジュールも使わない。package.json の "type": "module" で ESM として動く。

/** 1 回の取得のタイムアウト（ライブラリの既定の 10 秒より長め。runner からの遅さで誤検知しないように） */
export const TIMEOUT_MS = 20_000;
/** 成功とみなす版の形（数字とドットだけ。比較できても、`1` や `1.0-beta` のような形はストアの表示が変わった兆しとして落とす） */
export const VERSION = /^\d+(\.\d+)+$/;
/** Issue の本文の長さの上限。ストアから返った文字列が長くても、本文が大きくならないように */
export const MAX_MESSAGE_LENGTH = 300;
export const MAX_REPORT_LENGTH = 4_000;

// 見えない文字はソースに直接書かない（読んでも分からないため）。ゼロ幅スペースはコードポイントから作り、
// 制御文字（C0 / DEL / C1）と双方向の制御文字（ALM / LRM / RLM / LRE〜RLO / LRI〜PDI）は \u のエスケープで書く
const ZWSP = String.fromCodePoint(0x200b);
const INVISIBLE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 取り除く対象として制御文字を並べている
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g;

/**
 * Issue の本文・ログに出す文字列を無害にする。取得した文字列はコードブロックの中に入れるが、
 * コードブロックを閉じられないよう 3 連続以上のバッククォートを取り除き、念のためメンション（`@`）と
 * Issue の参照（`#123` / `GH-123`）の形もゼロ幅スペースで崩す。改行・制御文字・双方向の制御文字は空白にして
 * 1 行に収め、長さを切る
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export const sanitize = (value, max = MAX_MESSAGE_LENGTH) => {
  const text = String(value)
    .replace(INVISIBLE, ' ')
    .replace(/`{3,}/g, '')
    .replace(/@/g, `@${ZWSP}`)
    .replace(/#(?=\d)/g, `#${ZWSP}`)
    .replace(/\b(GH)-(?=\d)/gi, `$1${ZWSP}-`)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * エラーの `code`（StoreVersionError）か `name`。予期しない形なら固定の文字列にする
 * @param {any} error
 * @returns {string}
 */
export const codeOf = (error) => {
  const code = error?.code ?? error?.name;
  return typeof code === 'string' && /^[A-Za-z_]{1,40}$/.test(code)
    ? code
    : 'UNEXPECTED_ERROR';
};

/**
 * 1 段分の説明。message が空なら code → errors[0].message → name の順に使う
 * （undici の接続の失敗は message が空の AggregateError で、理由は code（ECONNREFUSED など）と errors に入る）
 * @param {any} error
 * @returns {string}
 */
const describeError = (error) => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const extra = /** @type {any} */ (error);
  for (const candidate of [
    error.message,
    extra.code,
    extra.errors?.[0]?.message,
    error.name,
  ]) {
    if (typeof candidate === 'string' && candidate !== '') {
      return candidate;
    }
  }
  return 'Error';
};

/**
 * message と、cause の message を 2 段まで（fetch の失敗は cause に ECONNRESET などの理由が入る）
 * @param {unknown} error
 * @returns {string}
 */
export const messageOf = (error) => {
  const parts = [];
  let current = error;
  for (let depth = 0; depth < 3 && current != null; depth += 1) {
    parts.push(describeError(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return sanitize(parts.join(' <- '));
};

/**
 * @typedef {{ platform: 'ios', id: string, country: string } | { platform: 'android', id: string }} App
 */

/**
 * CANARY_APPS を読む。書き方の誤りは errors に入れる（取得はせずに失敗として報告する）
 * @param {string | undefined} source
 * @returns {{ apps: App[], errors: string[] }}
 */
export const parseApps = (source) => {
  /** @type {App[]} */
  const apps = [];
  /** @type {string[]} */
  const errors = [];
  for (const [index, raw] of (source ?? '').split('\n').entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const [platform, id, country, ...rest] = line.split(/\s+/);
    if (platform === 'ios' && id && country && rest.length === 0) {
      apps.push({ platform, id, country });
    } else if (platform === 'android' && id && !country) {
      apps.push({ platform, id });
    } else {
      errors.push(
        `CANARY_APPS line ${index + 1} is not "ios <bundleId> <country>" or "android <package>": ${line}`
      );
    }
  }
  if (apps.length === 0 && errors.length === 0) {
    errors.push('CANARY_APPS has no apps');
  }
  return { apps, errors };
};

/**
 * @param {App} app
 * @returns {string}
 */
export const labelOf = (app) =>
  app.platform === 'ios'
    ? `ios ${app.id} (${app.country})`
    : `android ${app.id}`;

/**
 * @typedef {{ version?: unknown, releaseNotes?: unknown, releaseDate?: unknown }} Fetched
 * @typedef {{
 *   lookupIOS: (target: { bundleId: string }, country: string, options: { timeoutMs: number }) => Promise<Fetched>,
 *   fetchAndroidVersion: (target: { packageName: string }, options: { timeoutMs: number }) => Promise<Fetched>,
 * }} Fetchers
 * @typedef {{ ok: true, version: string, releaseDate: string | null, hasNotes: boolean }
 *   | { ok: false, code: string, message: string }} CheckResult
 */

/**
 * 1 つのアプリの版を取る。reject しない。リリースノートと公開日は、取れたかどうかを結果の行に出すだけで、
 * 取れなくても失敗にしない（版の取得とは別の、添えるだけの値なので）
 * @param {App} app
 * @param {Fetchers} fetchers
 * @returns {Promise<CheckResult>}
 */
export const check = async (app, fetchers) => {
  try {
    const { version, releaseNotes, releaseDate } =
      app.platform === 'ios'
        ? await fetchers.lookupIOS({ bundleId: app.id }, app.country, {
            timeoutMs: TIMEOUT_MS,
          })
        : await fetchers.fetchAndroidVersion(
            { packageName: app.id },
            { timeoutMs: TIMEOUT_MS }
          );
    if (typeof version !== 'string' || !VERSION.test(version)) {
      return {
        ok: false,
        code: 'UNEXPECTED_VERSION_FORMAT',
        message: sanitize(
          `the version is not digits and dots: ${JSON.stringify(version)}`
        ),
      };
    }
    return {
      ok: true,
      version,
      releaseDate: typeof releaseDate === 'string' ? releaseDate : null,
      hasNotes: typeof releaseNotes === 'string' && releaseNotes !== '',
    };
  } catch (error) {
    return { ok: false, code: codeOf(error), message: messageOf(error) };
  }
};

/**
 * 報告の 1 件。platform は設定の誤り・dist の読み込みの失敗の行には無い
 * @typedef {{ label: string, platform?: 'ios' | 'android' } & CheckResult} Result
 */

/**
 * 実行の URL（GitHub Actions の環境変数から。形が想定外なら出さない）
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export const runUrl = (env) => {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (
    /^https:\/\/[A-Za-z0-9.-]+$/.test(GITHUB_SERVER_URL ?? '') &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY ?? '') &&
    /^\d+$/.test(GITHUB_RUN_ID ?? '')
  ) {
    return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  }
  return null;
};

/**
 * 結果の行（コードブロックの中に入れる）。全体の長さを MAX_REPORT_LENGTH で切る。
 * 成功の行には公開日と、リリースノートの有無を出す（本文は出さない）
 * @param {Result[]} results
 * @returns {string[]}
 */
export const reportLines = (results) => {
  const lines = [];
  let length = 0;
  for (const [index, result] of results.entries()) {
    const line = result.ok
      ? `ok      ${sanitize(result.label)}: ${result.version} (releaseDate: ${result.releaseDate === null ? 'none' : sanitize(result.releaseDate)}, notes: ${result.hasNotes ? 'yes' : 'no'})`
      : `FAILED  ${sanitize(result.label)}: ${result.code}: ${result.message}`;
    if (length + line.length + 1 > MAX_REPORT_LENGTH) {
      lines.push(`... (${results.length - index} more)`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines;
};

/**
 * 版は取れたが、Google Play のページから公開日が取れなかったときの警告（GitHub Actions の workflow command の行）。
 * Play の公開日は、調べたページのすべてにあったので、取れないのはページの形が変わった兆し。
 * canary は失敗にせず（Issue も立てない）、実行の画面と annotations に出すだけにする。
 * リリースノートは「新機能」が空のアプリもあるので対象にしない。文面にストア由来の値は入れない
 * @param {Result[]} results
 * @returns {string[]}
 */
export const warningsFor = (results) =>
  results
    .filter(
      (result) =>
        result.ok &&
        result.platform === 'android' &&
        result.releaseDate === null
    )
    .map(
      (result) =>
        `::warning::the release date was not found on the Google Play page (${sanitize(result.label)}); the page structure may have changed`
    );

/**
 * Issue の本文と Job Summary の Markdown。ストア由来の文字列はコードブロックの中だけに置く
 * @param {Result[]} results
 * @param {number} failed
 * @param {string | null} url
 * @returns {string}
 */
export const toMarkdown = (results, failed, url) =>
  [
    failed === 0
      ? `The canary got the app versions from the stores (all ${results.length} checks passed).`
      : `The canary could not get the app versions from the stores (${failed} of ${results.length} checks failed).`,
    '',
    ...(url ? [`Run: ${url}`, ''] : []),
    '```text',
    ...reportLines(results),
    '```',
    '',
  ].join('\n');
