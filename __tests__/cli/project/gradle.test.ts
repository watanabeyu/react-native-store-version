/**
 * @jest-environment node
 */
// build.gradle(.kts) の簡易な読み取り（マスク・ブロックの範囲・文の値）
import {
  findBlock,
  findStatement,
  hasWord,
  maskGradle,
} from '../../../src/cli/project/gradle.ts';

const statementIn = (source: string, block: string, name: string) => {
  const masked = maskGradle(source);
  const range = findBlock(masked, block);
  if (range === null) {
    throw new Error(`no ${block}`);
  }
  return findStatement(source, masked, name, range);
};

describe('maskGradle', () => {
  it('blanks comments and the contents of strings, keeping the length, quotes and newlines', () => {
    const source = [
      'a { // b { c',
      '/* d {',
      ' } */ "e { \\" }" \'f }\' """g',
      '{""" x',
      '"open {',
    ].join('\n');
    const masked = maskGradle(source);
    expect(masked).toHaveLength(source.length);
    expect(masked).toBe(
      [
        'a {         ',
        '      ',
        '      "        " \'   \' """ ',
        ' """ x',
        '"      ',
      ].join('\n')
    );
  });

  it('handles unterminated comments and triple-quoted strings', () => {
    expect(maskGradle('a /* b {')).toBe('a       ');
    expect(maskGradle("a '''b {")).toBe("a '''   ");
    expect(maskGradle('a // b')).toBe('a     ');
  });
});

describe('findBlock', () => {
  it('finds the range of the first block, counting nested braces and not braces in strings or comments', () => {
    const source =
      'android {\n  defaultConfig {\n    x "}"\n    nested { y }\n    // }\n  }\n  defaultConfig { second }\n}';
    const masked = maskGradle(source);
    const range = findBlock(masked, 'defaultConfig');
    expect(range && source.slice(range.start, range.end)).toBe(
      '\n    x "}"\n    nested { y }\n    // }\n  '
    );
  });

  it('is null when there is no block, or it is not closed', () => {
    expect(findBlock(maskGradle('android { }'), 'defaultConfig')).toBeNull();
    expect(
      findBlock(maskGradle('"defaultConfig { }"'), 'defaultConfig')
    ).toBeNull();
    expect(
      findBlock(maskGradle('defaultConfig { {'), 'defaultConfig')
    ).toBeNull();
    expect(
      findBlock(maskGradle('a { } b { defaultConfig { } }'), 'defaultConfig', {
        start: 0,
        end: 5,
      })
    ).toBeNull();
  });
});

describe('findStatement', () => {
  it.each([
    ['Groovy with double quotes', 'applicationId "com.example.a"'],
    ['Groovy with single quotes', "applicationId 'com.example.a'"],
    ['Kotlin', 'applicationId = "com.example.a"'],
    ['a trailing comment', 'applicationId "com.example.a" // the ID'],
    ['a semicolon', 'applicationId "com.example.a"; versionCode 1'],
    ['the block on one line', 'applicationId "com.example.a" }'],
  ])('reads a literal (%s)', (_, line) => {
    expect(
      statementIn(
        `defaultConfig {\n  ${line}\n}`,
        'defaultConfig',
        'applicationId'
      )
    ).toEqual({ literal: 'com.example.a' });
  });

  it('reads a literal right after the opening brace', () => {
    expect(
      statementIn(
        'defaultConfig { applicationId "a" }',
        'defaultConfig',
        'applicationId'
      )
    ).toEqual({ literal: 'a' });
  });

  it.each([
    ['a variable', 'applicationId appId', 'appId'],
    [
      'a property',
      'applicationId = rootProject.ext.appId',
      'rootProject.ext.appId',
    ],
    [
      'an interpolated string',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Groovy の GString の ${…} そのものを入力にする
      'applicationId "com.example.${flavor}"',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 同上（期待する式）
      '"com.example.${flavor}"',
    ],
    [
      'a Kotlin template',
      'applicationId = "com.example.$suffix"',
      '"com.example.$suffix"',
    ],
    [
      'a concatenation',
      'applicationId "com.example" + suffix',
      '"com.example" + suffix',
    ],
    ['a method call', 'applicationId("com.example.a")', '("com.example.a")'],
  ])('returns the expression for %s', (_, line, expression) => {
    expect(
      statementIn(
        `defaultConfig {\n  ${line}\n}`,
        'defaultConfig',
        'applicationId'
      )
    ).toEqual({ expression });
  });

  it('cuts a long expression', () => {
    const value = `x${'y'.repeat(100)}`;
    expect(
      statementIn(
        `defaultConfig {\n  applicationId ${value}\n}`,
        'defaultConfig',
        'applicationId'
      )
    ).toEqual({ expression: `${value.slice(0, 80)}…` });
  });

  it('ignores the name in nested blocks, in expressions, in comments, as a property, or without a value', () => {
    const source = [
      'defaultConfig {',
      '  // applicationId "commented"',
      '  buildConfigField "String", "ID", applicationId',
      '  applicationIdSuffix ".debug"',
      '  nested {',
      '    applicationId "nested"',
      '  }',
      '  applicationId.foo "property"',
      '  applicationId',
      '  "next line"',
      '}',
    ].join('\n');
    expect(statementIn(source, 'defaultConfig', 'applicationId')).toBeNull();
  });
});

describe('hasWord', () => {
  it('looks only outside comments and strings', () => {
    expect(hasWord(maskGradle('productFlavors {'), 'productFlavors')).toBe(
      true
    );
    expect(hasWord(maskGradle('// productFlavors'), 'productFlavors')).toBe(
      false
    );
    expect(hasWord(maskGradle('"productFlavors"'), 'productFlavors')).toBe(
      false
    );
    expect(hasWord(maskGradle('myProductFlavors'), 'productFlavors')).toBe(
      false
    );
  });
});
