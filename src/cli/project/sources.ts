// アプリのソース（.ts / .tsx / .js / .jsx）の走査（C8）。依存・ネイティブ・生成物のディレクトリは見ない。
// CI の時間を延ばさないよう、ファイル数と 1 ファイルの大きさに上限を設ける
import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/** 走査しないディレクトリの名前（どの深さでも）。依存・ビルドの生成物・VCS */
export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  '.expo',
  '.git',
  'Pods',
  'coverage',
  '.next',
]);

/**
 * `<cwd>` の直下のときだけ走査しないディレクトリ（ネイティブのプロジェクト）。深い所の `ios` / `android` は
 * プラットフォーム別のソース（`src/android/Root.tsx` など）でありうるので走査する
 */
export const ROOT_EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  'ios',
  'android',
]);

const EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** 走査の上限 */
export type ScanLimits = {
  /** 読むソースのファイル数。超えたら走査をやめる */
  maxFiles: number;
  /** 1 ファイルの大きさ（バイト）。超えたファイルは読まずに飛ばす（バンドル済み・生成された JS など） */
  maxFileBytes: number;
};

export const SCAN_LIMITS: ScanLimits = {
  maxFiles: 5_000,
  maxFileBytes: 1024 * 1024,
};

/** {@link scanSources} の結果 */
export type ScanResult = {
  /** 読んだファイルの数 */
  scanned: number;
  /** ファイル数の上限を超えて途中でやめた */
  truncated: boolean;
  /** 大きさの上限を超えて読まなかったファイル（絶対パス） */
  tooLarge: string[];
};

/**
 * 型宣言（`.d.ts`）は対象にしない。宣言に `getLatestVersion` などの名前があっても使っていることにはならないため
 * （ライブラリの型を写したものなどで、C8 を誤って黙らせないように）
 */
const isSource = (name: string): boolean =>
  EXTENSIONS.has(extname(name)) && !name.endsWith('.d.ts');

const readEntries = (dir: string): Dirent[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
  } catch {
    // 読めないディレクトリ（権限など）は飛ばす。C8 は簡易な注意なので、走査の失敗で CLI を落とさない
    return [];
  }
};

/**
 * `<cwd>` の下のソースを、名前の順に幅優先で読んで `visit` に渡す。シンボリックリンクは（ファイルもディレクトリも）辿らない
 * （node_modules の外を指すもの・循環を避ける）。読めないファイルは飛ばす
 */
export const scanSources = (
  cwd: string,
  visit: (path: string, text: string) => void,
  limits: ScanLimits = SCAN_LIMITS
): ScanResult => {
  const result: ScanResult = { scanned: 0, truncated: false, tooLarge: [] };
  let seen = 0;
  const queue = [cwd];
  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    for (const entry of readEntries(dir)) {
      // Dirent は lstat の結果なので、シンボリックリンクは isDirectory() / isFile() が false になる
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !EXCLUDED_DIRECTORIES.has(entry.name) &&
          !(dir === cwd && ROOT_EXCLUDED_DIRECTORIES.has(entry.name))
        ) {
          queue.push(path);
        }
        continue;
      }
      if (!entry.isFile() || !isSource(entry.name)) {
        continue;
      }
      seen += 1;
      if (seen > limits.maxFiles) {
        result.truncated = true;
        return result;
      }
      let text: string;
      try {
        if (statSync(path).size > limits.maxFileBytes) {
          result.tooLarge.push(path);
          continue;
        }
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      result.scanned += 1;
      visit(path, text);
    }
  }
  return result;
};
