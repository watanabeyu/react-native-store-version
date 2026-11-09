// `check` の結果の出力（spec 9.3）: テキスト / `--json` / GitHub Actions の注釈と Job Summary
import type { CheckEntry, Counts } from './result.ts';

/** 出力に渡す結果 */
export type Report = {
  /** 確かめたディレクトリ（絶対パス） */
  cwd: string;
  entries: readonly CheckEntry[];
  counts: Counts;
  exitCode: number;
};

const COMMAND = 'react-native-store-version check';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const countsLine = ({ error, warning, info }: Counts) =>
  `${plural(error, 'error')}, ${plural(warning, 'warning')}, ${info} info`;

const textLine = ({ id, level, message }: CheckEntry) =>
  `  ${level.padEnd(8)} ${id}  ${message}`;

/** テキストの出力（末尾の改行まで） */
export const formatText = (report: Report): string =>
  [
    `${COMMAND}: ${report.cwd}`,
    ...(report.entries.length === 0
      ? ['  (no checks were run)']
      : report.entries.map(textLine)),
    countsLine(report.counts),
    '',
  ].join('\n');

/** `--json` の出力（末尾の改行まで）。entries は `results` に、出したときと同じ順で入る */
export const formatJson = (report: Report): string =>
  `${JSON.stringify(
    {
      cwd: report.cwd,
      results: report.entries,
      counts: report.counts,
      exitCode: report.exitCode,
    },
    null,
    2
  )}\n`;

/** ワークフローコマンドの message のエスケープ（`%` を最初に置き換える。後の置き換えで入る `%` を二重にしないため） */
export const escapeData = (value: string): string =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** ワークフローコマンドの property（`title` など）のエスケープ。message のエスケープに `:` と `,` を足す */
export const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

const ANNOTATION = {
  error: 'error',
  warning: 'warning',
  info: 'notice',
} as const;

/**
 * GitHub Actions 上の出力（末尾の改行まで）。error / warning / info は `::error::` / `::warning::` / `::notice::` の注釈にし
 * （ログにも本文が出る）、ok / skipped はテキストと同じ行で出す
 */
export const formatGithub = (report: Report): string =>
  [
    `${COMMAND}: ${report.cwd}`,
    ...report.entries.map((entry) =>
      entry.level === 'ok' || entry.level === 'skipped'
        ? textLine(entry)
        : `::${ANNOTATION[entry.level]} title=${escapeProperty(`${COMMAND} ${entry.id}`)}::${escapeData(entry.message)}`
    ),
    countsLine(report.counts),
    '',
  ].join('\n');

/** Markdown の表のセルに入れる文字列。HTML として読まれないようにし、`|` と改行で表が崩れないようにする */
const escapeCell = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');

/** Job Summary（`GITHUB_STEP_SUMMARY` のファイル）に追記する Markdown（前後を空行で区切る） */
export const formatSummary = (report: Report): string =>
  [
    '',
    `### ${COMMAND}`,
    '',
    `Directory: <code>${escapeCell(report.cwd)}</code>`,
    '',
    ...(report.entries.length === 0
      ? ['No checks were run.']
      : [
          '| Check | Result | Message |',
          '| --- | --- | --- |',
          ...report.entries.map(
            ({ id, level, message }) =>
              `| ${id} | ${level} | ${escapeCell(message)} |`
          ),
        ]),
    '',
    countsLine(report.counts),
    '',
  ].join('\n');
