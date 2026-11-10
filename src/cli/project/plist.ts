// Xcode の project.pbxproj（OpenStep 形式の ASCII property list）の読み取り。
// 正規表現で `PRODUCT_BUNDLE_IDENTIFIER = …` を拾うと、どのターゲット・どの構成（Debug / Release）の値かが分からない
// （テストや extension のターゲットも同じキーを持つ）ので、全体を値に直してからオブジェクト ID で辿る（ios.ts）

/** pbxproj の値。数値・真偽値も文字列のまま（`objectVersion = 54;` は `'54'`） */
export type PlistValue = string | PlistValue[] | PlistDict;

/** 辞書。キーは pbxproj のまま（`__proto__` などでプロトタイプを触らないよう、プロトタイプの無いオブジェクトにする） */
export type PlistDict = { [key: string]: PlistValue };

export const isDict = (value: PlistValue | undefined): value is PlistDict =>
  typeof value === 'object' && !Array.isArray(value);

/** 引用符なしの文字列を終える文字（空白と区切り記号） */
const DELIMITER = /[\s{}()=;,"<>]/;

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
};

/**
 * OpenStep 形式の property list を値に直す。コメント（`/* … *\/` と `// …`。先頭の `// !$*UTF8*$!` も）は読み飛ばす。
 * 形が崩れていれば Error を投げる（位置を添える）
 */
export const parsePlist = (text: string): PlistValue => {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`${what} at offset ${i}`);
  };

  const skipSpace = () => {
    for (;;) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i += 1;
      } else if (c === '/' && text[i + 1] === '/') {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end + 1;
      } else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        if (end === -1) {
          fail('unterminated comment');
        }
        i = end + 2;
      } else {
        return;
      }
    }
  };

  const expect = (char: string) => {
    skipSpace();
    if (text[i] !== char) {
      fail(`expected "${char}"`);
    }
    i += 1;
  };

  const quoted = (): string => {
    // 開きの `"` の次から
    i += 1;
    let out = '';
    for (;;) {
      const c = text[i];
      if (c === undefined) {
        return fail('unterminated string');
      }
      i += 1;
      if (c === '"') {
        return out;
      }
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i];
      if (e === undefined) {
        return fail('unterminated string');
      }
      i += 1;
      if ((e === 'U' || e === 'u') && /^[0-9A-Fa-f]{4}/.test(text.slice(i))) {
        out += String.fromCharCode(Number.parseInt(text.slice(i, i + 4), 16));
        i += 4;
      } else if (/[0-7]/.test(e)) {
        // 8 進のエスケープ（最大 3 桁）
        const digits = /^[0-7]{0,2}/.exec(text.slice(i))?.[0] ?? '';
        out += String.fromCharCode(Number.parseInt(e + digits, 8));
        i += digits.length;
      } else {
        out += ESCAPES[e] ?? e;
      }
    }
  };

  const unquoted = (): string => {
    const start = i;
    while (i < text.length) {
      const c = text[i];
      // `/*` と `//` はコメントの始まり（Xcode は値の直後に空白を入れてコメントを書く）
      if (DELIMITER.test(c) || (c === '/' && /[/*]/.test(text[i + 1] ?? ''))) {
        break;
      }
      i += 1;
    }
    if (i === start) {
      fail(
        text[i] === undefined
          ? 'unexpected end'
          : `unexpected ${JSON.stringify(text[i])}`
      );
    }
    return text.slice(start, i);
  };

  const value = (): PlistValue => {
    skipSpace();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const dict: PlistDict = Object.create(null);
      for (;;) {
        skipSpace();
        if (text[i] === '}') {
          i += 1;
          return dict;
        }
        const key = text[i] === '"' ? quoted() : unquoted();
        expect('=');
        dict[key] = value();
        expect(';');
      }
    }
    if (c === '(') {
      i += 1;
      const list: PlistValue[] = [];
      for (;;) {
        skipSpace();
        if (text[i] === ')') {
          i += 1;
          return list;
        }
        list.push(value());
        skipSpace();
        if (text[i] === ',') {
          i += 1;
        } else if (text[i] !== ')') {
          fail('expected "," or ")"');
        }
      }
    }
    if (c === '"') {
      return quoted();
    }
    if (c === '<') {
      // <data>（16 進のバイト列）。pbxproj では使われないが、形としては読み飛ばせるようにする
      const end = text.indexOf('>', i);
      if (end === -1) {
        fail('unterminated data');
      }
      const data = text.slice(i, end + 1);
      i = end + 1;
      return data;
    }
    return unquoted();
  };

  const result = value();
  skipSpace();
  if (i < text.length) {
    fail('unexpected content after the root value');
  }
  return result;
};
