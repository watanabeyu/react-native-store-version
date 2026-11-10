/**
 * @jest-environment node
 */
// JSX の開始タグの属性の簡易な読み取り
import {
  findOpeningTags,
  maskSource,
  readObjectLiteral,
} from '../../../src/cli/project/jsx.ts';

const tags = (source: string) =>
  findOpeningTags(source, 'StoreVersionProvider');

describe('findOpeningTags', () => {
  it('reads the attributes of each opening tag, with the values as written', () => {
    expect(
      tags(`
        <StoreVersionProvider policy={{ major: 'force' }} country="jp" enabled>
        <StoreVersionProvider/>
        <StoreVersionProvider
          policy='x'
          {...props}
          {/* comment with } and > */}
          ui={false}
        />`)
    ).toEqual([
      {
        attributes: [
          { name: 'policy', value: "{{ major: 'force' }}" },
          { name: 'country', value: '"jp"' },
          { name: 'enabled', value: null },
        ],
        spreads: 0,
      },
      { attributes: [], spreads: 0 },
      {
        attributes: [
          { name: 'policy', value: "'x'" },
          { name: 'ui', value: '{false}' },
        ],
        // コメントだけの {/* … */} は spread ではない
        spreads: 1,
      },
    ]);
  });

  it('does not end the tag at ">" inside expressions, strings, template literals or comments', () => {
    expect(
      tags(`<StoreVersionProvider
        onResult={(r) => r.action > 0 && log("}>", '{', \`\${r.a > 1 ? '}' : "{"}\`)}
        texts={{ title: 'a > b' } /* } > */}
        // policy="in a comment"
        /* policy */ policy={policy}
      >`)
    ).toEqual([
      {
        attributes: [
          {
            name: 'onResult',
            value: `{(r) => r.action > 0 && log("}>", '{', \`\${r.a > 1 ? '}' : "{"}\`)}`,
          },
          { name: 'texts', value: "{{ title: 'a > b' } /* } > */}" },
          { name: 'policy', value: '{policy}' },
        ],
        spreads: 0,
      },
    ]);
  });

  it('handles line comments, escapes and unquoted values', () => {
    expect(
      tags(`<StoreVersionProvider a={x // }
      } b="say \\"hi\\"" c=<X /> >`)
    ).toEqual([
      {
        attributes: [
          { name: 'a', value: '{x // }\n      }' },
          { name: 'b', value: '"say \\"hi\\""' },
          { name: 'c', value: '<X' },
        ],
        spreads: 0,
      },
    ]);
  });

  it('does not match other names', () => {
    expect(
      tags(
        '<StoreVersionProviderX /> <StoreVersionProvider.Item /> <MyStoreVersionProvider /> StoreVersionProvider'
      )
    ).toEqual([]);
  });

  it('reads to the end of an unterminated tag', () => {
    expect(tags('<StoreVersionProvider policy={{ major')).toEqual([
      { attributes: [{ name: 'policy', value: '{{ major' }], spreads: 0 },
    ]);
    expect(tags('<StoreVersionProvider a="x')).toEqual([
      { attributes: [{ name: 'a', value: '"x' }], spreads: 0 },
    ]);
    expect(tags('<StoreVersionProvider a={/* x')).toEqual([
      { attributes: [{ name: 'a', value: '{/* x' }], spreads: 0 },
    ]);
    expect(tags('<StoreVersionProvider a={// x')).toEqual([
      { attributes: [{ name: 'a', value: '{// x' }], spreads: 0 },
    ]);
    expect(tags('<StoreVersionProvider ! a')).toEqual([
      { attributes: [{ name: 'a', value: null }], spreads: 0 },
    ]);
    expect(tags('<StoreVersionProvider // x')).toEqual([
      { attributes: [], spreads: 0 },
    ]);
    expect(tags('<StoreVersionProvider /* x')).toEqual([
      { attributes: [], spreads: 0 },
    ]);
  });
});

describe('findOpeningTags in comments and strings', () => {
  it('does not count tags in comments or string literals', () => {
    expect(
      tags(`// <StoreVersionProvider policy="a">
/* <StoreVersionProvider policy="b"> */
const s = '<StoreVersionProvider policy="c">';
const t = "<StoreVersionProvider policy='d'>";
const u = \`
  <StoreVersionProvider policy="e">
\`;
<StoreVersionProvider policy="f">`)
    ).toEqual([{ attributes: [{ name: 'policy', value: '"f"' }], spreads: 0 }]);
  });

  it('reads the attributes from the source (the strings in them are kept)', () => {
    expect(
      tags("<StoreVersionProvider policy={{ major: 'force' }} // x\n>")
    ).toEqual([
      {
        attributes: [{ name: 'policy', value: "{{ major: 'force' }}" }],
        spreads: 0,
      },
    ]);
  });

  it('recovers on the next line after an apostrophe in JSX text (a known limitation on the same line)', () => {
    expect(
      tags("<Text>Don't</Text>\n<StoreVersionProvider policy={p}>")
    ).toEqual([{ attributes: [{ name: 'policy', value: '{p}' }], spreads: 0 }]);
    expect(tags("<Text>Don't</Text> <StoreVersionProvider>")).toEqual([]);
  });
});

describe('maskSource', () => {
  it('blanks comments (and the contents of strings with strings: true), keeping the length, quotes and newlines', () => {
    const source = "a // b\n/* c\n d */ 'e\\'f' \"g\" `h\ni` 'open\nj";
    const comments = maskSource(source, { strings: false });
    const all = maskSource(source, { strings: true });
    expect(comments).toHaveLength(source.length);
    expect(all).toHaveLength(source.length);
    expect(comments).toBe("a     \n    \n      'e\\'f' \"g\" `h\ni` 'open\nj");
    expect(all).toBe("a     \n    \n      '    ' \" \" ` \n ` '    \nj");
  });

  it('handles unterminated comments and strings', () => {
    expect(maskSource('a /* b', { strings: false })).toBe('a     ');
    expect(maskSource('a `b', { strings: true })).toBe('a ` ');
  });
});

describe('readObjectLiteral', () => {
  it('reads the top-level keys and values', () => {
    expect(
      readObjectLiteral(
        `{ major: Platform.OS === 'android' ? 'warning' : 'force', 'minor': { a: 1, b: [2, 3] }, "patch": null /* c */, shorthand, }`
      )
    ).toEqual({
      properties: new Map([
        ['major', "Platform.OS === 'android' ? 'warning' : 'force'"],
        ['minor', '{ a: 1, b: [2, 3] }'],
        ['patch', 'null'],
        ['shorthand', null],
      ]),
      spread: false,
    });
  });

  it.each([
    ['{ ...base, minor: "warning" }'],
    ['{ [key]: "force" }'],
    ['{ major() { return "force"; } }'],
  ])('marks %s as having keys it cannot tell', (text) => {
    expect(readObjectLiteral(text)?.spread).toBe(true);
  });

  it('does not split at commas in strings', () => {
    expect(readObjectLiteral('{ a: "x, y", b: 1 }')?.properties).toEqual(
      new Map([
        ['a', '"x, y"'],
        ['b', '1'],
      ])
    );
  });

  it.each([['POLICY'], ['{ a: 1 } && x'], ['(diff) => ({})'], ['']])(
    'is null for %j',
    (text) => {
      expect(readObjectLiteral(text)).toBeNull();
    }
  );
});
