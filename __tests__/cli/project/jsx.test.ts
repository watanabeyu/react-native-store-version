/**
 * @jest-environment node
 */
// JSX の開始タグの属性の簡易な読み取り
import { findOpeningTags } from '../../../src/cli/project/jsx.ts';

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
        spreads: 2,
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
