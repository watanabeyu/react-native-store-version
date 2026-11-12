// 実ストア（App Store の iTunes Lookup と Google Play の詳細ページ）から、既知のアプリの版を取得できるかを確かめる。
// ライブラリの取得処理（ビルドした dist/fetchers/*.js）をそのまま使う。react-native は読まない（Node だけで動く）。
// 結果の判定と報告の文面は canary-report.js（ネットワークなしでテストできる部分）にある。ここは取得とファイルの読み書きだけ。
//
// usage: CANARY_APPS='<一覧>' node .github/scripts/canary.mjs <Issue の本文のファイル>
//   CANARY_APPS: 1 行に 1 アプリ。`ios <bundleId> <country>` か `android <package 名>`。空行と `#` で始まる行は読み飛ばす。
//                一覧は .github/workflows/canary.yml の env に書く（手元ではそこからコピーして渡す）
//   すべて取れたら終了コード 0 で、本文のファイルは作らない（前の実行の残りがあれば消す）。
//   1 つでも失敗したら（一覧の書き方の誤りも含む）終了コード 1 で、本文のファイルを書く。
//   GITHUB_STEP_SUMMARY があれば、成功・失敗とも結果を Job Summary に書く（本文のファイルを書いた後。Summary に書けなくても
//   本文は残す）
//   Google Play のページから公開日が取れなかったときは、`::warning::` の行を出す（失敗にはしない）
//
// 実ストアに出るので、手元で何度も続けて実行しない。同じストアへの取得の間は間隔を空ける（下の MIN_INTERVAL_MS）。
// リトライはしない（混んでいるストアを重ねて叩かない。一時的な失敗は、次の日の実行で回復するかを Issue で見る）
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';

import {
  check,
  codeOf,
  labelOf,
  messageOf,
  parseApps,
  reportLines,
  runUrl,
  sanitize,
  toMarkdown,
  warningsFor,
} from './canary-report.js';

// RN の Android の fetch が送る User-Agent（テストの fixture もこれで取っている）。Node の fetch の既定の UA では、
// アプリが受け取るものとは別のページが返りうる。ほかのヘッダ・cookie は足さない
const USER_AGENT = 'okhttp/4.12.0';
// 同じストアへの取得の間隔（ms）。Play は重いページなので長めに空ける
const MIN_INTERVAL_MS = { ios: 3_000, android: 8_000 };

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      results.push({ label: labelOf(app), platform: app.platform, ...result });
    }
  }

  const failed = results.filter((result) => !result.ok).length;
  const markdown = toMarkdown(results, failed, runUrl(process.env));
  for (const line of reportLines(results)) {
    console.log(line);
  }
  for (const line of warningsFor(results)) {
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
