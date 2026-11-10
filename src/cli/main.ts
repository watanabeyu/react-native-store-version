// CLI の本体（index.ts が Node の版を確かめてから読み込む）。引数の解析・チェックの実行・出力・終了コード。
// Node の標準モジュールと、react-native を読まないライブラリ本体のファイルだけを使う（CLI のための依存は足さない）
import { appendFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { runChecks } from './check.ts';
import {
  formatGithub,
  formatGithubFailure,
  formatJson,
  formatSummary,
  formatText,
  oneLine,
  type Report,
} from './output.ts';
import { countEntries, exitCodeOf } from './result.ts';

/** C3 の App Store の国の既定 */
export const DEFAULT_COUNTRY = 'us';

/** `--help` の出力 */
export const USAGE = `Usage: react-native-store-version check [options]

Checks the setup of react-native-store-version in an app.

Options:
  --cwd <dir>       the app directory (default: the current directory)
  --json            print the result as JSON
  --strict          exit with 1 on warnings too
  --ignore <ids>    comma-separated checks not to run (e.g. C4,C8)
  --country <xx>    the App Store country for C3 (default: ${DEFAULT_COUNTRY})
  -h, --help        show this help
`;

/** {@link run} が使う外界（テストから差し替える） */
export type RunContext = {
  /** `--cwd` の相対パスの起点と既定 */
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** 引数の誤り。使い方と一緒に stderr に出し、終了コード 1 にする */
class UsageError extends Error {}

type CheckArgs = {
  cwd: string;
  json: boolean;
  strict: boolean;
  ignore: Set<string>;
  country: string;
};

const parseIgnore = (values: readonly string[]): Set<string> => {
  const ids = new Set<string>();
  for (const value of values) {
    for (const part of value.split(',')) {
      const id = part.trim().toUpperCase();
      if (id === '') {
        continue;
      }
      // ID の形だけを見る（無い ID は何も止めないだけなので、誤りにはしない）
      if (!/^C\d+$/.test(id)) {
        throw new UsageError(
          `--ignore: ${JSON.stringify(part.trim())} is not a check ID (e.g. C1)`
        );
      }
      ids.add(id);
    }
  }
  return ids;
};

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      cwd: { type: 'string' },
      json: { type: 'boolean' },
      strict: { type: 'boolean' },
      ignore: { type: 'string', multiple: true },
      country: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

/** 引数を解析する。`--help` なら null */
const parseCheckArgs = (
  argv: readonly string[],
  context: RunContext
): CheckArgs | null => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    // parseArgs の誤り（不明なオプション・値の無い --cwd など）
    throw new UsageError(errorMessage(error));
  }
  const { values, positionals } = parsed;
  if (values.help) {
    return null;
  }
  const [command, ...rest] = positionals;
  if (command === undefined) {
    throw new UsageError('no command given');
  }
  if (command !== 'check') {
    throw new UsageError(`unknown command: ${command}`);
  }
  if (rest.length > 0) {
    throw new UsageError(`unexpected argument: ${rest[0]}`);
  }

  const cwd = resolve(context.cwd, values.cwd ?? '.');
  let isDirectory = false;
  try {
    isDirectory = statSync(cwd).isDirectory();
  } catch {
    // 無いパスも、下でディレクトリでない扱いにする
  }
  if (!isDirectory) {
    throw new UsageError(`--cwd: ${cwd} is not a directory`);
  }

  const country = values.country ?? DEFAULT_COUNTRY;
  // iTunes Lookup の country は 2 文字の国コード
  if (!/^[A-Za-z]{2}$/.test(country)) {
    throw new UsageError(
      `--country: ${JSON.stringify(country)} is not a 2-letter country code`
    );
  }

  return {
    cwd,
    json: values.json ?? false,
    strict: values.strict ?? false,
    ignore: parseIgnore(values.ignore ?? []),
    country: country.toLowerCase(),
  };
};

/**
 * CLI を引数 `argv`（`process.argv.slice(2)`）で動かし、終了コードを返す。例外は投げない
 * （引数の誤り・想定外の失敗は stderr に出して 1。GitHub Actions 上では stderr に `::error::` の注釈も出し、
 * stdout には何も出さない（`--json` の stdout を JSON 以外で汚さないため。runner は stderr のコマンドも処理する））
 */
export const run = async (
  argv: readonly string[],
  context: RunContext
): Promise<number> => {
  const onGithub = context.env.GITHUB_ACTIONS === 'true';
  const fail = (message: string, usage: boolean): 1 => {
    // GitHub Actions 上では、message の改行で次の行がワークフローコマンドにならないよう 1 行にする
    const line = onGithub ? oneLine(message) : message;
    context.stderr(`error: ${line}\n${usage ? `\n${USAGE}` : ''}`);
    if (onGithub) {
      context.stderr(formatGithubFailure(message));
    }
    return 1;
  };

  let args: CheckArgs | null;
  try {
    args = parseCheckArgs(argv, context);
  } catch (error) {
    return fail(errorMessage(error), true);
  }
  if (args === null) {
    context.stdout(USAGE);
    return 0;
  }

  let report: Report;
  try {
    const entries = await runChecks({
      cwd: args.cwd,
      country: args.country,
      ignore: args.ignore,
    });
    const counts = countEntries(entries);
    report = {
      cwd: args.cwd,
      entries,
      counts,
      exitCode: exitCodeOf(counts, args.strict),
    };
  } catch (error) {
    return fail(errorMessage(error), false);
  }

  if (args.json) {
    // stdout は JSON だけにする（GitHub Actions 上でも注釈を混ぜない）
    context.stdout(formatJson(report));
  } else if (onGithub) {
    context.stdout(formatGithub(report));
  } else {
    context.stdout(formatText(report));
  }
  // Job Summary はファイルへの追記で stdout を汚さないので、--json でも書く
  const summary = context.env.GITHUB_STEP_SUMMARY;
  if (onGithub && summary) {
    try {
      appendFileSync(summary, formatSummary(report));
    } catch (error) {
      // Job Summary は付け足しの表示なので、書けなくてもチェックの結果（終了コード）は変えない
      context.stderr(
        `warning: could not write the job summary: ${errorMessage(error)}\n`
      );
    }
  }
  return report.exitCode;
};

/** `process` につないで {@link run} を動かす（index.ts から呼ぶ） */
export const main = async (): Promise<void> => {
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
};
