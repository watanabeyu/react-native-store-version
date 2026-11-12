/**
 * @jest-environment node
 */
// アプリのファイルを読むときの共通部分
import { join } from 'node:path';

import {
  displayPath,
  hasVariable,
  isDirectory,
  isFile,
  readText,
} from '../../../src/cli/project/files.ts';
import { createProject, type Project } from '../../__helpers__/project.ts';

describe('files', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    project.remove();
  });

  it('tells files from directories and reads text, without throwing for missing paths', () => {
    project.write('a/b.txt', 'text');
    expect(isFile(join(project.dir, 'a', 'b.txt'))).toBe(true);
    expect(isFile(join(project.dir, 'a'))).toBe(false);
    expect(isDirectory(join(project.dir, 'a'))).toBe(true);
    expect(isDirectory(join(project.dir, 'a', 'b.txt'))).toBe(false);
    expect(isDirectory(join(project.dir, 'missing'))).toBe(false);
    expect(readText(join(project.dir, 'a', 'b.txt'))).toBe('text');
    expect(readText(join(project.dir, 'missing'))).toBeNull();
  });

  it('displays a path relative to cwd with "/", and keeps paths outside cwd absolute', () => {
    expect(displayPath('/app', '/app/ios/A.xcodeproj')).toBe('ios/A.xcodeproj');
    expect(displayPath('/app', '/app')).toBe('/app');
    expect(displayPath('/app/mobile', '/app/node_modules/x')).toBe(
      '/app/node_modules/x'
    );
  });

  it.each([
    ['$(PRODUCT_NAME)', true],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: xcconfig の ${…} の参照そのものを入力にする
    ['com.example.${SUFFIX}', true],
    ['com.example', false],
    ['$5', false],
  ])('hasVariable(%j) is %s', (value, expected) => {
    expect(hasVariable(value)).toBe(expected);
  });
});
