// android/app/build.gradle(.kts)（Groovy / Kotlin の DSL）の簡易な読み取り。Gradle を動かさずに、ブロック
// （`defaultConfig { … }`）の範囲と、その直下の `name "literal"` / `name = "literal"` の形の値だけを読む。
//
// 範囲は波括弧の対応で取る。文字列とコメントの中の波括弧・キーワードを数えないよう、先に「マスク」（コメントを空白に、
// 文字列の中身を空白にした同じ長さの写し。引用符と改行は残す）を作り、探すのはマスクの上、値を読むのは元の文字列の上で行う。
// 限界: Groovy の slashy string（`/…/`・`$/…/$`）と、`"${ … }"` の中にさらに `"` を書いたものは文字列として扱えない
// （アプリの build.gradle の defaultConfig / android の周りではまず使われない）

/** 文字列の範囲（`start` から `end` の手前まで） */
export type Range = { start: number; end: number };

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/** {@link maskGradle} の 1 つの区間（コメント・文字列）の終わり */
const endOf = (source: string, i: number): { end: number; kind: string } => {
  const two = source.slice(i, i + 2);
  if (two === '//') {
    const nl = source.indexOf('\n', i);
    return { end: nl === -1 ? source.length : nl, kind: 'comment' };
  }
  if (two === '/*') {
    const close = source.indexOf('*/', i + 2);
    return { end: close === -1 ? source.length : close + 2, kind: 'comment' };
  }
  const three = source.slice(i, i + 3);
  if (three === '"""' || three === "'''") {
    const close = source.indexOf(three, i + 3);
    return { end: close === -1 ? source.length : close + 3, kind: three };
  }
  const quote = source[i];
  if (quote === '"' || quote === "'") {
    let j = i + 1;
    while (j < source.length && source[j] !== quote && source[j] !== '\n') {
      j += source[j] === '\\' ? 2 : 1;
    }
    // 閉じが無い（行末まで）ものも、その行で終わった文字列として扱う
    return { end: Math.min(j + 1, source.length), kind: quote };
  }
  return { end: i, kind: '' };
};

/**
 * コメントを空白に、文字列の中身を空白にした、`source` と同じ長さの文字列。位置はそのまま `source` に対応する
 */
export const maskGradle = (source: string): string => {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const { end, kind } = endOf(source, i);
    if (kind === '') {
      out += source[i];
      i += 1;
      continue;
    }
    const part = source.slice(i, end);
    if (kind === 'comment') {
      out += blank(part);
    } else {
      // 引用符（1 文字または 3 文字）は残し、中身だけ消す
      const q = kind.length;
      const closed = part.length >= q * 2 && part.endsWith(kind);
      out += closed
        ? kind + blank(part.slice(q, part.length - q)) + kind
        : kind + blank(part.slice(q));
    }
    i = end;
  }
  return out;
};

/** `masked` の `from` から `to` の手前までの、波括弧の深さの増減 */
const depthBetween = (masked: string, from: number, to: number): number => {
  let depth = 0;
  for (let i = from; i < to; i += 1) {
    if (masked[i] === '{') {
      depth += 1;
    } else if (masked[i] === '}') {
      depth -= 1;
    }
  }
  return depth;
};

/**
 * `range` の中で最初の `<name> {` のブロックの中身の範囲（`{` の次から、対応する `}` の手前まで）。
 * 無い・閉じていなければ null
 */
export const findBlock = (
  masked: string,
  name: string,
  range: Range = { start: 0, end: masked.length }
): Range | null => {
  const pattern = new RegExp(`\\b${name}\\s*\\{`, 'g');
  pattern.lastIndex = range.start;
  const match = pattern.exec(masked);
  if (match === null || match.index >= range.end) {
    return null;
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < range.end; i += 1) {
    if (masked[i] === '{') {
      depth += 1;
    } else if (masked[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start, end: i };
      }
    }
  }
  return null;
};

/** {@link findStatement} の結果。文字列のリテラルなら `literal`、そうでなければ書かれている式（1 行・長いものは切る） */
export type Statement =
  | { literal: string; expression?: undefined }
  | { literal?: undefined; expression: string };

const MAX_EXPRESSION = 80;

/**
 * `range` の直下（入れ子のブロックの中は見ない）で、文の頭にある最初の `<name> <value>` / `<name> = <value>` の値。
 * `<value>` が `"…"`（`$` による埋め込みを含まない）か `'…'` だけならリテラル。無ければ null
 */
export const findStatement = (
  source: string,
  masked: string,
  name: string,
  range: Range
): Statement | null => {
  const pattern = new RegExp(`\\b${name}\\b`, 'g');
  pattern.lastIndex = range.start;
  for (
    let match = pattern.exec(masked);
    match !== null && match.index < range.end;
    match = pattern.exec(masked)
  ) {
    // 文の頭（行頭か、`;` / `{` の後）にあるものだけ。`buildConfigField …, applicationId` のような式の中の名前は見ない
    const lineBefore = masked.slice(
      masked.lastIndexOf('\n', match.index - 1) + 1,
      match.index
    );
    const atHead = /(^|[;{])[ \t]*$/.test(lineBefore);
    let i = match.index + name.length;
    // `applicationId.foo` のようなプロパティの参照は値の設定ではない
    if (
      !atHead ||
      masked[i] === '.' ||
      depthBetween(masked, range.start, match.index) !== 0
    ) {
      continue;
    }
    i += /^[ \t]*(=[ \t]*)?/.exec(masked.slice(i))?.[0].length ?? 0;
    // 文の終わり（改行・`;`・ブロックの閉じ）。行末のコメントはマスクでは空白なので落とす
    const rest = masked.slice(i, range.end);
    const stop = rest.search(/[\n;}]/);
    const value = source.slice(
      i,
      i + rest.slice(0, stop === -1 ? rest.length : stop).trimEnd().length
    );
    if (value === '') {
      // 値の無い名前だけの行（次の行に値を書く形は読まない）
      continue;
    }
    const literal = /^"([^"\\$\n]*)"$|^'([^'\\\n]*)'$/.exec(value);
    if (literal) {
      return { literal: literal[1] ?? literal[2] };
    }
    return {
      expression:
        value.length > MAX_EXPRESSION
          ? `${value.slice(0, MAX_EXPRESSION)}…`
          : value,
    };
  }
  return null;
};

/** マスクの上で `name` という語があるか（コメント・文字列の中は数えない） */
export const hasWord = (masked: string, name: string): boolean =>
  new RegExp(`\\b${name}\\b`).test(masked);
