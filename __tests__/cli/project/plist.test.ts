/**
 * @jest-environment node
 */
// project.pbxproj（OpenStep 形式の property list）の読み取り
import { isDict, parsePlist } from '../../../src/cli/project/plist.ts';
import { readFixture } from '../../__helpers__/fetch.ts';

describe('parsePlist', () => {
  it('reads dictionaries, arrays, quoted and unquoted strings, skipping comments', () => {
    expect(
      parsePlist(`// !$*UTF8*$!
{
  a = 1; /* comment { ( */
  "quoted key" = "with \\"escapes\\" \\\\ \\n\\t\\U00e9\\101";
  list = (
    x /* comment */,
    "y",
  );
  empty = ();
  nested = {isa = PBXFileReference; path = ../a/b.swift; };
  data = <0fbd 7700>;
  // line comment
}`)
    ).toEqual({
      a: '1',
      'quoted key': 'with "escapes" \\ \n\té\x41',
      list: ['x', 'y'],
      empty: [],
      nested: { isa: 'PBXFileReference', path: '../a/b.swift' },
      data: '<0fbd 7700>',
    });
  });

  it('keeps "$(…)" as a string (Xcode quotes it because of the parentheses)', () => {
    expect(
      parsePlist('{ a = "$(PRODUCT_NAME:rfc1034identifier)"; b = $X; }')
    ).toEqual({ a: '$(PRODUCT_NAME:rfc1034identifier)', b: '$X' });
  });

  it('does not let keys touch the prototype', () => {
    const dict = parsePlist('{ __proto__ = x; constructor = y; }');
    expect(isDict(dict) && Object.keys(dict)).toEqual([
      '__proto__',
      'constructor',
    ]);
    expect(Object.getPrototypeOf(dict)).toBeNull();
  });

  it('reads the fixtures', () => {
    const root = parsePlist(
      readFixture('cli/bare-rn/ios/BareApp.xcodeproj/project.pbxproj')
    );
    expect(isDict(root) && root.rootObject).toBe('83CBB9F71A601CBA00E9B192');
  });

  it('reads the values copied from a real project (the expo-native fixture)', () => {
    const root = parsePlist(
      readFixture('cli/expo-native/ios/ExpoNative.xcodeproj/project.pbxproj')
    );
    const objects = isDict(root) && isDict(root.objects) ? root.objects : {};
    const phase = objects['00DD1BFF1BD5951E006B06BC'];
    const script = isDict(phase) ? phase.shellScript : undefined;
    expect(typeof script).toBe('string');
    // \" と \n が元に戻り、バッククォートと $(…) はそのまま
    expect(script).toContain(
      'if [[ -f "$SRCROOT/.xcode.env" ]]; then\n  source'
    );
    expect(script).toContain(
      '"`"$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'"`"'
    );
    expect(script).toContain('export ENTRY_FILE="$("$NODE_BINARY" -e');
    const group = objects['13B07FAE1A68108700A75B9A'];
    expect(isDict(group) && group.sourceTree).toBe('<group>');
    const release = objects['83CBBA211A601CBA00E9B192'];
    const settings =
      isDict(release) && isDict(release.buildSettings)
        ? release.buildSettings
        : {};
    expect(settings['CODE_SIGN_IDENTITY[sdk=iphoneos*]']).toBe(
      'iPhone Developer'
    );
    expect(settings.LIBRARY_SEARCH_PATHS).toBe(
      '$(SDKROOT)/usr/lib/swift"$(inherited)"'
    );
  });

  it.each([
    ['{ a = 1 }', 'expected ";" at offset 8'],
    ['{ a 1; }', 'expected "=" at offset 4'],
    ['{ a = "x; }', 'unterminated string at offset 11'],
    ['{ a = "x\\', 'unterminated string at offset 9'],
    ['{ a = (x y); }', 'expected "," or ")" at offset 9'],
    ['{ a = 1; } x', 'unexpected content after the root value at offset 11'],
    ['{ a = 1; /* x', 'unterminated comment at offset 9'],
    ['{ a = <00; }', 'unterminated data at offset 6'],
    ['{ a = ; }', 'unexpected ";" at offset 6'],
    ['{ a = ', 'unexpected end at offset 6'],
  ])('throws on %j', (text, message) => {
    expect(() => parsePlist(text)).toThrow(new Error(message));
  });

  it('isDict tells dictionaries from strings and arrays', () => {
    expect(isDict({})).toBe(true);
    expect(isDict([])).toBe(false);
    expect(isDict('x')).toBe(false);
    expect(isDict(undefined)).toBe(false);
  });
});
