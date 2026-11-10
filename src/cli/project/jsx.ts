// ソースの JSX の開始タグ（`<StoreVersionProvider …>`）の属性の簡易な読み取り（C8）。構文解析はせず、
// 属性の `{ … }` の中の波括弧・文字列・コメントを数えて、開始タグの終わりの `>` を見つける（`onResult={(r) => …}` の `>` で
// 終わらないように）。タグはコメントと文字列の中身を消した写し（maskSource）の上で探す（コメントアウトしたタグや、
// 文字列に書いたコードの例をタグとして数えない）。
// 限界（構文解析をしないため。詳しくは maskSource）:
// - JSX のテキストの中のアポストロフィ・引用符（`fallback={<Text>Don't</Text>}` のように属性の式の中に書いた JSX や、
//   タグの手前の同じ行の `<Text>Don't</Text>`）を文字列の始まりとして読み、その行の範囲を読み違える
// - JSX のテキストの中の `//` / ` /* `（空白の後）はコメントとして読む（`//` はその行、`/*` は次の `*/` まで消える）
// - テキストのバッククォートが、後ろの本物のテンプレートリテラルの開きと対になると、その間を文字列として読む
// - 割り算と正規表現は直前の文字だけで見分ける（`if (x) /re/.test(s)` の `)` の後や、JSX のテキストの `{a}/{b}/` は読み違える）
// - 属性の `{ … }` の中（readAttributes）は正規表現リテラルを数えない（属性の式ではまず使われない）

/** 開始タグの属性。`value` は `"…"` / `{…}` を含む書かれたままの文字列。値の無い属性（`<X flag>`）は null */
export type JsxAttribute = { name: string; value: string | null };

/** 開始タグ。`{...props}` のような spread は属性の名前が分からないので数だけを持つ（C8 で policy が spread から来うるかに使う） */
export type JsxOpeningTag = { attributes: JsxAttribute[]; spreads: number };

/** `text[i]` の引用符で始まる文字列の終わりの次の位置。テンプレートリテラルの `${ … }` は式として飛ばす */
const skipString = (text: string, i: number): number => {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
    } else if (c === quote) {
      return j + 1;
    } else if (quote === '`' && c === '$' && text[j + 1] === '{') {
      j = skipBraces(text, j + 1);
    } else {
      j += 1;
    }
  }
  return text.length;
};

/** `text[i]` の `{` に対応する `}` の次の位置。閉じていなければ末尾 */
const skipBraces = (text: string, i: number): number => {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(text, j);
      continue;
    }
    if (c === '/' && text[j + 1] === '/') {
      const end = text.indexOf('\n', j);
      j = end === -1 ? text.length : end;
      continue;
    }
    if (c === '/' && text[j + 1] === '*') {
      const end = text.indexOf('*/', j + 2);
      j = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        return j + 1;
      }
    }
    j += 1;
  }
  return text.length;
};

const NAME = /^[A-Za-z_$][\w$.:-]*/;

/** `from` から開始タグの終わり（`>` / `/>`）までの属性を読む */
const readAttributes = (text: string, from: number): JsxOpeningTag => {
  const attributes: JsxAttribute[] = [];
  let spreads = 0;
  let i = from;
  // 空白と、属性の間に書ける JS のコメント（`// …` / `/* … */`）を飛ばす
  const skipSpace = () => {
    for (;;) {
      if (/\s/.test(text[i] ?? '')) {
        i += 1;
      } else if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end;
      } else if (text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
      } else {
        return;
      }
    }
  };
  for (;;) {
    skipSpace();
    const c = text[i];
    if (c === undefined || c === '>' || (c === '/' && text[i + 1] === '>')) {
      return { attributes, spreads };
    }
    if (c === '{') {
      // `{...props}`。コメントだけの `{/* … */}` は spread ではない
      const end = skipBraces(text, i);
      if (
        maskSource(text.slice(i + 1, end - 1), { strings: false })
          .trim()
          .startsWith('...')
      ) {
        spreads += 1;
      }
      i = end;
      continue;
    }
    const name = NAME.exec(text.slice(i))?.[0];
    if (name === undefined) {
      // 属性として読めない文字（壊れた・途中までのソース）は 1 文字ずつ飛ばす
      i += 1;
      continue;
    }
    i += name.length;
    skipSpace();
    if (text[i] !== '=') {
      attributes.push({ name, value: null });
      continue;
    }
    i += 1;
    skipSpace();
    const start = i;
    const v = text[i];
    if (v === '"' || v === "'") {
      i = skipString(text, i);
    } else if (v === '{') {
      i = skipBraces(text, i);
    } else {
      while (i < text.length && !/[\s>]/.test(text[i])) {
        i += 1;
      }
    }
    attributes.push({ name, value: text.slice(start, i) });
  }
};

const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

/** この文字の後の `/` は正規表現の始まり（割り算ではない） */
const REGEX_AFTER = /[(,=:[!&|?{};]/;

/** この語の後の `/` は正規表現の始まり */
const REGEX_AFTER_WORDS: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'instanceof',
  'yield',
  'await',
]);

/** ここまでのマスク（`out`）の後に来る `/` が正規表現の始まりか（直前の空白でない文字・語・行頭で決める） */
const startsRegex = (out: string): boolean => {
  const tail = out.slice(-64).replace(/[ \t]+$/, '');
  if (tail === '' || tail.endsWith('\n')) {
    return true;
  }
  if (REGEX_AFTER.test(tail[tail.length - 1])) {
    return true;
  }
  const word = /[A-Za-z_$][\w$]*$/.exec(tail)?.[0];
  return word !== undefined && REGEX_AFTER_WORDS.has(word);
};

/**
 * `source[i]` の `/` で始まる正規表現リテラルの終わり（フラグの後）。文字クラス `[…]` の中の `/` とエスケープは閉じとみなさない。
 * 同じ行に閉じが無ければ -1（正規表現ではない）
 */
const regexEnd = (source: string, i: number): number => {
  let inClass = false;
  for (let j = i + 1; j < source.length; j += 1) {
    const c = source[j];
    if (c === '\n') {
      return -1;
    }
    if (c === '\\') {
      j += 1;
    } else if (inClass) {
      inClass = c !== ']';
    } else if (c === '[') {
      inClass = true;
    } else if (c === '/') {
      let end = j + 1;
      while (/[a-z]/.test(source[end] ?? '')) {
        end += 1;
      }
      return end;
    }
  }
  return -1;
};

/**
 * `source` と同じ長さの写しで、コメント（`// …` / `/* … *\/`）を空白にしたもの（改行は残す）。`strings` なら、
 * 文字列・テンプレートリテラル・正規表現リテラルの中身も空白にする（引用符と `/` は残す）。
 *
 * 読み違えの被害を小さくするため:
 * - `'…'` / `"…"` は行末で終わったものとして扱う（JS の文字列は改行をまたがない。JSX のテキストのアポストロフィで
 *   読み違えても、その行だけで済む）
 * - 正規表現リテラルは、`/` の前が `(` `,` `=` などの記号・`return` などの語・行頭のときだけ。同じ行に閉じが無ければ正規表現にしない
 * - `\` の直後の `//` / `/*`、語の直後の `/*`（`src/*.ts` のようなパス・glob）はコメントの始まりにしない
 * - 閉じないブロックコメント・テンプレートリテラルは、その記号をただの文字として扱い、続きをそのまま読む（残りを全部消さない）
 */
export const maskSource = (
  source: string,
  { strings }: { strings: boolean }
): string => {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const before = source[i - 1] ?? '';
    if (c === '/' && source[i + 1] === '/' && before !== '\\') {
      const close = source.indexOf('\n', i);
      const end = close === -1 ? source.length : close;
      out += blank(source.slice(i, end));
      i = end;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (before !== '\\' && !/[\w$.]/.test(before) && close !== -1) {
        out += blank(source.slice(i, close + 2));
        i = close + 2;
        continue;
      }
    } else if (c === '/' && source[i + 1] !== '>' && startsRegex(out)) {
      const end = regexEnd(source, i);
      if (end !== -1) {
        const close = source.lastIndexOf('/', end - 1);
        const body = source.slice(i + 1, close);
        out += `/${strings ? blank(body) : body}${source.slice(close, end)}`;
        i = end;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (
        j < source.length &&
        source[j] !== c &&
        (c === '`' || source[j] !== '\n')
      ) {
        j += source[j] === '\\' ? 2 : 1;
      }
      const closed = j < source.length && source[j] === c;
      if (closed || c !== '`') {
        const content = source.slice(i + 1, Math.min(j, source.length));
        out += c + (strings ? blank(content) : content) + (closed ? c : '');
        i = closed ? j + 1 : Math.min(j, source.length);
        continue;
      }
      // 閉じないテンプレートリテラル（テキストのバッククォート 1 つなど）は、ただの文字として続きを読む
    }
    out += c;
    i += 1;
  }
  return out;
};

/**
 * `source` の中の `<component …>` の開始タグ（`<componentX` / `<component.Item` は別の名前なので入らない）。
 * コメント・文字列の中のものは数えない（{@link maskSource}）。属性は元のソースから読む
 */
export const findOpeningTags = (
  source: string,
  component: string
): JsxOpeningTag[] => {
  const pattern = new RegExp(`<${component}(?![\\w$.:-])`, 'g');
  const tags: JsxOpeningTag[] = [];
  for (const match of maskSource(source, { strings: true }).matchAll(pattern)) {
    tags.push(readAttributes(source, match.index + match[0].length));
  }
  return tags;
};

/** オブジェクトリテラルの最上位のプロパティ。`spread` は `...x` / 計算されたキー（`[k]: v`）があって、ほかのキーが分からない */
export type ObjectLiteral = {
  /** キー → 値の式（前後の空白とコメントを除く）。短縮形（`{ major }`）は null */
  properties: Map<string, string | null>;
  spread: boolean;
};

/**
 * `expression`（前後の空白は無視）が `{ … }` のオブジェクトリテラル（末尾の `as …` / `satisfies …` は除く）なら、
 * その最上位のプロパティ。そうでなければ null
 */
export const readObjectLiteral = (expression: string): ObjectLiteral | null => {
  const text = maskSource(expression, { strings: false }).trim();
  if (!text.startsWith('{')) {
    return null;
  }
  const end = skipBraces(text, 0);
  // 末尾の TypeScript の型の注釈（`as const` / `as Policy` / `satisfies Policy`。続けて書いたものも）は値を変えない
  if (!/^((as|satisfies)\s+\S[\s\S]*)?$/.test(text.slice(end).trim())) {
    return null;
  }
  const body = text.slice(1, end - 1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; ) {
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(body, i);
      continue;
    }
    if ('([{'.includes(c)) {
      depth += 1;
    } else if (')]}'.includes(c)) {
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(body.slice(start));

  const properties = new Map<string, string | null>();
  let spread = false;
  for (const part of parts.map((p) => p.trim())) {
    if (part === '') {
      continue;
    }
    const match =
      /^(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*(?::([\s\S]*))?$/.exec(
        part
      );
    if (match === null) {
      // `...base` / `[key]: v` はキーが分からない。メソッド（`major() {}`）なども、ここでは分からないものとして扱う
      spread = true;
      continue;
    }
    properties.set(
      match[1] ?? match[2] ?? match[3],
      match[4] === undefined ? null : match[4].trim()
    );
  }
  return { properties, spread };
};
