// アプリのファイルを読むときの共通部分。読めないファイル・ディレクトリは例外にせず「無い」として扱う
// （チェックの材料が無いだけで、CLI 全体は落とさない）
import { readFileSync, statSync } from 'node:fs';
import { relative, sep } from 'node:path';

export const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** UTF-8 のテキストとして読む。無い・読めなければ null */
export const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * メッセージに出すパス（`<cwd>` からの相対。区切りは `/`）。`<cwd>` の外なら絶対パスのまま。
 * どのファイルの値かを、CI のログでもリポジトリの中の場所として読めるようにする
 */
export const displayPath = (cwd: string, path: string): string => {
  const rel = relative(cwd, path);
  if (rel === '' || rel.startsWith('..')) {
    return path;
  }
  return rel.split(sep).join('/');
};

/** 値が `$(…)` / `${…}` のようにほかの設定を参照しているか（ビルド時にしか決まらないので「特定できない」にする） */
export const hasVariable = (value: string): boolean => /\$[({]/.test(value);

/** 1 つのファイルから読んだ値（{@link Lookup} の見つかった側） */
export type Found = {
  value: string;
  /** 値の名前（`PRODUCT_BUNDLE_IDENTIFIER` / `versionName` など） */
  label: string;
  /** 値を読んだファイル（{@link displayPath}） */
  file: string;
};

/** ネイティブのファイルから値を探した結果。見つからなければ、その理由（メッセージにそのまま入る英文） */
export type Lookup = Found | { value: null; reason: string };
