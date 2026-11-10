// ソースの JSX の開始タグ（`<StoreVersionProvider …>`）の属性の簡易な読み取り（C8）。構文解析はせず、
// 属性の `{ … }` の中の波括弧・文字列・コメントを数えて、開始タグの終わりの `>` を見つける（`onResult={(r) => …}` の `>` で
// 終わらないように）。正規表現リテラルの中の波括弧・引用符は数えない（属性の式ではまず使われない）

/** 開始タグの属性。`value` は `"…"` / `{…}` を含む書かれたままの文字列。値の無い属性（`<X flag>`）は null */
export type JsxAttribute = { name: string; value: string | null };

/** 開始タグ。`{...props}` のような spread は属性の名前が分からないので数だけを持つ */
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
      // `{...props}`（とコメントの `{/* … */}`）
      spreads += 1;
      i = skipBraces(text, i);
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

/** `source` の中の `<component …>` の開始タグ（`<componentX` / `<component.Item` は別の名前なので入らない） */
export const findOpeningTags = (
  source: string,
  component: string
): JsxOpeningTag[] => {
  const pattern = new RegExp(`<${component}(?![\\w$.:-])`, 'g');
  const tags: JsxOpeningTag[] = [];
  for (const match of source.matchAll(pattern)) {
    tags.push(readAttributes(source, match.index + match[0].length));
  }
  return tags;
};
