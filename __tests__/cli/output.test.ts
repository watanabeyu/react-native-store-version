/**
 * @jest-environment node
 */
// 出力の 3 形態（テキスト / JSON / GitHub Actions の注釈と Job Summary）とエスケープ
import {
  escapeData,
  escapeProperty,
  formatGithub,
  formatGithubFailure,
  formatJson,
  formatSummary,
  formatText,
  type Report,
} from '../../src/cli/output.ts';

const report: Report = {
  cwd: '/app',
  entries: [
    { id: 'C1', level: 'error', message: 'not installed' },
    { id: 'C3', level: 'warning', message: 'not found' },
    { id: 'C3', level: 'ok', message: 'on Google Play' },
    { id: 'C7', level: 'info', message: 'no peers' },
    { id: 'C3', level: 'skipped', message: 'no ID' },
  ],
  counts: { error: 1, warning: 1, info: 1 },
  exitCode: 1,
};

const empty: Report = {
  cwd: '/app',
  entries: [],
  counts: { error: 0, warning: 0, info: 0 },
  exitCode: 0,
};

describe('escapeData / escapeProperty (workflow commands)', () => {
  it('escapes % first, then CR and LF in the message', () => {
    expect(escapeData('100%\r\nnext\n%0A')).toBe('100%25%0D%0Anext%0A%250A');
    expect(escapeData('a: b, c')).toBe('a: b, c');
  });

  it('also escapes : and , in properties', () => {
    expect(escapeProperty('C1: a, b%\n')).toBe('C1%3A a%2C b%25%0A');
  });
});

describe('formatText', () => {
  it('prints one line per entry and the counts', () => {
    expect(formatText(report)).toBe(
      [
        'react-native-store-version check: /app',
        '  error    C1  not installed',
        '  warning  C3  not found',
        '  ok       C3  on Google Play',
        '  info     C7  no peers',
        '  skipped  C3  no ID',
        '1 error, 1 warning, 1 info',
        '',
      ].join('\n')
    );
  });

  it('says so when no checks were run (all ignored), with plural counts', () => {
    expect(formatText(empty)).toBe(
      [
        'react-native-store-version check: /app',
        '  (no checks were run)',
        '0 errors, 0 warnings, 0 info',
        '',
      ].join('\n')
    );
  });
});

describe('formatJson', () => {
  it('prints cwd, results, counts and exitCode', () => {
    const text = formatJson(report);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      cwd: '/app',
      results: report.entries,
      counts: { error: 1, warning: 1, info: 1 },
      exitCode: 1,
    });
  });
});

describe('formatGithub', () => {
  it('turns error / warning / info into ::error:: / ::warning:: / ::notice:: annotations, and keeps ok / skipped as text', () => {
    expect(formatGithub(report)).toBe(
      [
        'react-native-store-version check: /app',
        '::error title=react-native-store-version check C1::not installed',
        '::warning title=react-native-store-version check C3::not found',
        '  ok       C3  on Google Play',
        '::notice title=react-native-store-version check C7::no peers',
        '  skipped  C3  no ID',
        '1 error, 1 warning, 1 info',
        '',
      ].join('\n')
    );
  });

  it('puts the cwd and the message of ok / skipped on one line, so that no line starts with :: (a workflow command)', () => {
    const injected: Report = {
      ...report,
      cwd: '/app\n::warning::cwd',
      entries: [
        { id: 'C3', level: 'ok', message: 'found\n::warning::x' },
        { id: 'C3', level: 'skipped', message: 'none\r\n::error::y\r' },
        { id: 'C1', level: 'error', message: 'real\n::notice::z' },
      ],
    };
    const lines = formatGithub(injected).split('\n');
    expect(lines.filter((line) => line.startsWith('::'))).toEqual([
      '::error title=react-native-store-version check C1::real%0A::notice::z',
    ]);
    expect(lines.slice(0, 3)).toEqual([
      'react-native-store-version check: /app ::warning::cwd',
      '  ok       C3  found ::warning::x',
      '  skipped  C3  none  ::error::y ',
    ]);
    // テキストの出力も同じく 1 行にする
    expect(
      formatText(injected)
        .split('\n')
        .filter((line) => line.startsWith('::'))
    ).toEqual([]);
    expect(formatText(injected).split('\n')).toHaveLength(6);
  });

  it('escapes the message of an annotation', () => {
    const text = formatGithub({
      ...report,
      entries: [
        { id: 'C1', level: 'error', message: '50% done:\r\nline 2, ok' },
      ],
    });
    expect(text.split('\n')[1]).toBe(
      '::error title=react-native-store-version check C1::50%25 done:%0D%0Aline 2, ok'
    );
  });
});

describe('formatGithubFailure', () => {
  it('is one ::error:: annotation with the escaped message', () => {
    expect(formatGithubFailure('bad: 1%\r\n::warning::x')).toBe(
      '::error title=react-native-store-version check::bad: 1%25%0D%0A::warning::x\n'
    );
  });
});

describe('formatSummary', () => {
  it('is a Markdown table of all entries, separated by blank lines', () => {
    expect(formatSummary(report)).toBe(
      [
        '',
        '### react-native-store-version check',
        '',
        'Directory: <code>/app</code>',
        '',
        '| Check | Result | Message |',
        '| --- | --- | --- |',
        '| C1 | error | not installed |',
        '| C3 | warning | not found |',
        '| C3 | ok | on Google Play |',
        '| C7 | info | no peers |',
        '| C3 | skipped | no ID |',
        '',
        '1 error, 1 warning, 1 info',
        '',
      ].join('\n')
    );
  });

  it('escapes |, newlines and HTML in cells', () => {
    const text = formatSummary({
      ...report,
      cwd: '/a|<b>&c',
      entries: [{ id: 'C1', level: 'error', message: 'a | b\nc\r\n<script>&' }],
    });
    expect(text).toContain('Directory: <code>/a\\|&lt;b&gt;&amp;c</code>');
    expect(text).toContain(
      '| C1 | error | a \\| b<br>c<br>&lt;script&gt;&amp; |'
    );
  });

  it('says so when no checks were run', () => {
    expect(formatSummary(empty)).toContain('\nNo checks were run.\n');
    expect(formatSummary(empty)).not.toContain('| Check |');
  });
});
