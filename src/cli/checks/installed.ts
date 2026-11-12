// C1: react-native-store-version がインストールされていて v2 以上か
import { readFileSync } from 'node:fs';

import { compareVersion } from '../../compare.ts';
import { findPackageJson } from '../packages.ts';
import type { CheckEntry } from '../result.ts';

const PACKAGE_NAME = 'react-native-store-version';

/**
 * v2 の最初の版（プレリリースを含む）。`2.0.0-beta.x` も `2.0.0` もこれ以上になる
 */
const V2_FLOOR = '2.0.0-0';

/**
 * C1。`<cwd>` から `react-native-store-version/package.json` を探して（{@link findPackageJson}）`name` と `version` を読む。
 * `npm:react-native-store-version@1` のようなエイリアス名で入れたもの（`react-native-store-version-v1` など）は見ない。
 *
 * - 見つからない / 読めない / 別のパッケージ / version が比較できない → error
 * - v2 より前（`2.0.0-0` より小さい）→ info
 */
export const checkInstalled = (cwd: string): CheckEntry[] => {
  const entry = (level: CheckEntry['level'], message: string): CheckEntry[] => [
    { id: 'C1', level, message },
  ];

  const path = findPackageJson(cwd, PACKAGE_NAME);
  if (path === null) {
    return entry(
      'error',
      `${PACKAGE_NAME} is not installed (no node_modules/${PACKAGE_NAME}/package.json in ${cwd} or its parents)`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return entry(
      'error',
      `could not read ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const { name, version } = (json ?? {}) as {
    name?: unknown;
    version?: unknown;
  };
  if (name !== PACKAGE_NAME) {
    return entry(
      'error',
      `${path} is not ${PACKAGE_NAME} (name: ${JSON.stringify(name)})`
    );
  }

  let result: ReturnType<typeof compareVersion>;
  try {
    if (typeof version !== 'string') {
      throw new TypeError('not a string');
    }
    // compareVersion(local, remote) は remote の方が新しいときに 'new'。つまり version < 2.0.0-0
    result = compareVersion(version, V2_FLOOR);
  } catch {
    return entry(
      'error',
      `could not read the version of ${PACKAGE_NAME} in ${path} (version: ${JSON.stringify(version)})`
    );
  }
  if (result === 'new') {
    return entry(
      'info',
      `${PACKAGE_NAME} ${version} is v1. StoreVersionProvider and this check are for v2 or later`
    );
  }
  return entry('ok', `${PACKAGE_NAME} ${version} is installed`);
};
