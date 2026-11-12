// 実ストア（App Store の iTunes Lookup と Google Play の詳細ページ）から、既知のアプリの版を取得できるかを確かめる。
// ライブラリの取得処理（ビルドした dist/fetchers/*.js）をそのまま使う。react-native は読まない（Node だけで動く）。
//
// usage: CANARY_APPS='<一覧>' node .github/scripts/canary.mjs <Issue の本文のファイル>
//   CANARY_APPS: 1 行に 1 アプリ。`ios <bundleId> <country>` か `android <package 名>`。空行と `#` で始まる行は読み飛ばす。
//                一覧は .github/workflows/canary.yml の env に書く（手元ではそこからコピーして渡す）
//   すべて取れたら終了コード 0 で、本文のファイルは作らない（前の実行の残りがあれば消す）。
//   1 つでも失敗したら（一覧の書き方の誤りも含む）終了コード 1 で、本文のファイルを書く。
//   GITHUB_STEP_SUMMARY があれば、成功・失敗とも結果を Job Summary に書く（本文のファイルを書いた後。Summary に書けなくても
//   本文は残す）
//
// 実ストアに出るので、手元で何度も続けて実行しない。同じストアへの取得の間は間隔を空ける（下の MIN_INTERVAL_MS）。
// リトライはしない（混んでいるストアを重ねて叩かない。一時的な失敗は、次の日の実行で回復するかを Issue で見る）
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';

// RN の Android の fetch が送る User-Agent（テストの fixture もこれで取っている）。Node の fetch の既定の UA では、
// アプリが受け取るものとは別のページが返りうる。ほかのヘッダ・cookie は足さない
const USER_AGENT = 'okhttp/4.12.0';
// 1 回の取得のタイムアウト（ライブラリの既定の 10 秒より長め。runner からの遅さで誤検知しないように）
const TIMEOUT_MS = 20_000;
// 同じストアへの取得の間隔（ms）。Play は重いページなので長めに空ける
const MIN_INTERVAL_MS = { ios: 3_000, android: 8_000 };
// 成功とみなす版の形（数字とドットだけ。比較できても、`1` や `1.0-beta` のような形はストアの表示が変わった兆しとして落とす）
const VERSION = /^\d+(\.\d+)+$/;
// Issue の本文の長さの上限。ストアから返った文字列が長くても、本文が大きくならないように
const MAX_MESSAGE_LENGTH = 300;
const MAX_REPORT_LENGTH = 4_000;

const bodyPath = process.argv[2];
if (!bodyPath) {
  console.error(
    'usage: CANARY_APPS=<apps> node .github/scripts/canary.mjs <body file>'
  );
  process.exit(1);
}

// globalThis.fetch を薄く包んで User-Agent だけを付ける（ライブラリは init に cache-control と signal しか入れない）
const baseFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('user-agent', USER_AGENT);
  return baseFetch(input, { ...init, headers });
};

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
 */
const sanitize = (value, max = MAX_MESSAGE_LENGTH) => {
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

/** エラーの `code`（StoreVersionError）か `name`。予期しない形なら固定の文字列にする */
const codeOf = (error) => {
  const code = error?.code ?? error?.name;
  return typeof code === 'string' && /^[A-Za-z_]{1,40}$/.test(code)
    ? code
    : 'UNEXPECTED_ERROR';
};

/**
 * 1 段分の説明。message が空なら code → errors[0].message → name の順に使う
 * （undici の接続の失敗は message が空の AggregateError で、理由は code（ECONNREFUSED など）と errors に入る）
 */
const describeError = (error) => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  for (const candidate of [
    error.message,
    error.code,
    error.errors?.[0]?.message,
    error.name,
  ]) {
    if (typeof candidate === 'string' && candidate !== '') {
      return candidate;
    }
  }
  return 'Error';
};

/** message と、cause の message を 2 段まで（fetch の失敗は cause に ECONNRESET などの理由が入る） */
const messageOf = (error) => {
  const parts = [];
  let current = error;
  for (let depth = 0; depth < 3 && current != null; depth += 1) {
    parts.push(describeError(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return sanitize(parts.join(' <- '));
};

/** CANARY_APPS を読む。書き方の誤りは errors に入れる（取得はせずに失敗として報告する） */
const parseApps = (source) => {
  const apps = [];
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

const labelOf = (app) =>
  app.platform === 'ios'
    ? `ios ${app.id} (${app.country})`
    : `android ${app.id}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 1 つのアプリの版を取る。reject しない */
const check = async (app, fetchers) => {
  try {
    const { version } =
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
    return { ok: true, version };
  } catch (error) {
    return { ok: false, code: codeOf(error), message: messageOf(error) };
  }
};

/** 実行の URL（GitHub Actions の環境変数から。形が想定外なら出さない） */
const runUrl = () => {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (
    /^https:\/\/[A-Za-z0-9.-]+$/.test(GITHUB_SERVER_URL ?? '') &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY ?? '') &&
    /^\d+$/.test(GITHUB_RUN_ID ?? '')
  ) {
    return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  }
  return null;
};

/** 結果の行（コードブロックの中に入れる）。全体の長さを MAX_REPORT_LENGTH で切る */
const reportLines = (results) => {
  const lines = [];
  let length = 0;
  for (const [index, result] of results.entries()) {
    const line = result.ok
      ? `ok      ${sanitize(result.label)}: ${result.version}`
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

/** Issue の本文と Job Summary の Markdown。ストア由来の文字列はコードブロックの中だけに置く */
const toMarkdown = (results, failed) => {
  const url = runUrl();
  return [
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
};

const main = async () => {
  const { apps, errors } = parseApps(process.env.CANARY_APPS);
  const results = errors.map((message) => ({
    ok: false,
    label: 'config',
    code: 'CONFIG',
    message: sanitize(message),
  }));

  let fetchers;
  try {
    const [ios, android] = await Promise.all([
      import(new URL('../../dist/fetchers/ios.js', import.meta.url).href),
      import(new URL('../../dist/fetchers/android.js', import.meta.url).href),
    ]);
    fetchers = {
      lookupIOS: ios.lookupIOS,
      fetchAndroidVersion: android.fetchAndroidVersion,
    };
  } catch (error) {
    results.push({
      ok: false,
      label: 'dist',
      code: codeOf(error),
      message: messageOf(error),
    });
  }

  if (fetchers) {
    // 1 件ずつ順に取る（同じストアへの同時の取得をしない）。間隔は前の取得が終わってから数える
    const lastDoneAt = {};
    for (const app of apps) {
      const last = lastDoneAt[app.platform];
      if (last !== undefined) {
        await sleep(
          Math.max(0, last + MIN_INTERVAL_MS[app.platform] - Date.now())
        );
      }
      const result = await check(app, fetchers);
      lastDoneAt[app.platform] = Date.now();
      results.push({ label: labelOf(app), ...result });
    }
  }

  const failed = results.filter((result) => !result.ok).length;
  const markdown = toMarkdown(results, failed);
  for (const line of reportLines(results)) {
    console.log(line);
  }

  // 本文のファイルを先に書く（Issue に使うのはこちら。Job Summary に書けなくても失われないように）
  if (failed === 0) {
    rmSync(bodyPath, { force: true });
  } else {
    writeFileSync(bodyPath, markdown);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, `### canary\n\n${markdown}`);
    } catch (error) {
      console.error(`could not write the job summary: ${messageOf(error)}`);
    }
  }

  return failed === 0 ? 0 : 1;
};

process.exitCode = await main();
