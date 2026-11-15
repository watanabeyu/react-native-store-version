// デフォルト UI の文言。型、英語の既定値、既定値との 1 段のマージと `{remote}` / `{local}` の置き換え、公開日の書式。
// React に依存しない純粋な関数にして、デフォルト UI と `components` の両方がこの結果を受け取る。
// 日本語のプリセットは src/texts/ja.ts（`react-native-store-version/texts/ja`）

/**
 * Force（強制アップデート）の文言。`{remote}`（最新バージョン）/ `{local}`（現在のバージョン）は表示時に置き換える
 * （公開日の書式 `releaseDate` は除く）
 */
export type StoreVersionForceTexts = {
  title: string;
  message: string;
  /** 更新ボタン */
  update: string;
  /** リリースノートの欄の見出し（Provider の `showReleaseNotes` を付けたときだけ出る） */
  whatsNew: string;
  /**
   * 公開日の書式。`{year}`（4 桁）/ `{month}`（1〜12）/ `{monthShort}`（英語の 3 文字。Jan〜Dec）/ `{day}`（1〜31）を
   * 表示時に置き換える。`{remote}` / `{local}` は置き換えない。`components` には書式のまま渡る
   */
  releaseDate: string;
};

/** Warning（閉じられるボトムシート）の文言。`{remote}` / `{local}` は表示時に置き換える（公開日の書式 `releaseDate` は除く） */
export type StoreVersionWarningTexts = {
  title: string;
  message: string;
  /** 更新ボタン */
  update: string;
  /** 「あとで」ボタン */
  later: string;
  /** リリースノートの欄の見出し（Provider の `showReleaseNotes` を付けたときだけ出る） */
  whatsNew: string;
  /**
   * 公開日の書式。`{year}`（4 桁）/ `{month}`（1〜12）/ `{monthShort}`（英語の 3 文字。Jan〜Dec）/ `{day}`（1〜31）を
   * 表示時に置き換える。`{remote}` / `{local}` は置き換えない。`components` には書式のまま渡る
   */
  releaseDate: string;
};

/**
 * Provider の `texts`。`force` / `warning` ごとに、指定しなかったキーは英語の既定値で補完する（1 段だけマージ）。
 * 日本語は `react-native-store-version/texts/ja` のプリセットを使う。変わったら表示中のモーダルにも反映する
 */
export type StoreVersionTexts = {
  force?: Partial<StoreVersionForceTexts>;
  warning?: Partial<StoreVersionWarningTexts>;
};

/** すべてのキーが埋まった文言（英語の既定値、`texts/ja` のプリセット、{@link resolveTexts} の結果の形） */
export type StoreVersionResolvedTexts = {
  force: StoreVersionForceTexts;
  warning: StoreVersionWarningTexts;
};

/** 英語の既定値（元のデザインと同じ文言） */
export const DEFAULT_TEXTS: StoreVersionResolvedTexts = {
  force: {
    title: 'Update required',
    message:
      'A new version ({remote}) is available. Please update to continue using the app.',
    update: 'Update',
    whatsNew: "What's new",
    releaseDate: '{monthShort} {day}, {year}',
  },
  warning: {
    title: 'Update available',
    message: 'Version {remote} is now available.',
    update: 'Update',
    later: 'Later',
    whatsNew: "What's new",
    releaseDate: '{monthShort} {day}, {year}',
  },
};

/** 置き換えに使う値。最新バージョンが比較できず、最低バージョンで force になったときは `remote` が null */
export type TextVariables = {
  local: string | null;
  remote: string | null;
};

// プレースホルダーと、それを直接囲む括弧（半角 / 全角）・その前の空白。1 回の replace で全部を扱う
// （置き換えた値をもう一度走査しないので、remote に "{local}" が入っていても二重に置換しない。
// String.prototype.replaceAll に頼らないので古い JSC でも動く）
const PLACEHOLDER = /(\s*)([(（]?)\{(local|remote)\}([)）]?)/g;

const isPair = (open: string, close: string) =>
  (open === '(' && close === ')') || (open === '（' && close === '）');

// `{remote}` / `{local}` のすべての出現を置き換える。値が null（Play の版が比較できず、最低バージョンで force になったとき）は
// 空文字にし、プレースホルダーを直接囲んでいた空の括弧「()」「（）」（とその前の空白）を取り除く。元の文言にある無関係な括弧は消さない。
// 余った空白（連続する空白・前後の空白）も取り除く。既定の英語は「A new version is available. …」、
// 日本語は「新しいバージョンが公開されています。…」になる。括弧を使っていない独自の文言では、ただ空文字に置き換わるだけ。
// 値がそろっているときは文言に手を加えない
const fill = (text: string, variables: TextVariables): string => {
  let emptied = false;
  const out = text.replace(
    PLACEHOLDER,
    (_match, space: string, open: string, key: string, close: string) => {
      const value = variables[key as keyof TextVariables];
      if (value !== null) {
        return `${space}${open}${value}${close}`;
      }
      emptied = true;
      return isPair(open, close) ? '' : `${space}${open}${close}`;
    }
  );
  return emptied ? out.replace(/ {2,}/g, ' ').trim() : out;
};

// 指定された値が文字列のときだけ使う（JS からの利用で数値や null を渡されても既定の文言に戻す）
const textOrDefault = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

// 公開日の書式（`releaseDate`）だけは `{remote}` / `{local}` を置き換えない。日付のプレースホルダーを持つ書式で、
// 表示するときに formatReleaseDate で日付を当てる（`components` にも書式のまま渡す）
const resolveValue = (
  key: keyof StoreVersionForceTexts | keyof StoreVersionWarningTexts,
  value: unknown,
  fallback: string,
  variables: TextVariables
): string => {
  const text = textOrDefault(value, fallback);
  return key === 'releaseDate' ? text : fill(text, variables);
};

/**
 * Provider の `texts` を表示用の文言にする。`force` / `warning` ごとに、指定しなかったキー（文字列でない値も）を英語の既定値で
 * 補完し（1 段だけマージ）、`{remote}` / `{local}` のすべての出現を置き換える（公開日の書式 `releaseDate` は補完するだけで、置き換えない）。
 * `texts` / `local` / `remote` が変わるたびに呼ぶ（`texts` の変更を表示中のモーダルにも即座に反映するため）
 */
export const resolveTexts = (
  texts: StoreVersionTexts | undefined,
  variables: TextVariables
): StoreVersionResolvedTexts => {
  const force = { ...DEFAULT_TEXTS.force };
  const warning = { ...DEFAULT_TEXTS.warning };
  for (const key of Object.keys(force) as (keyof StoreVersionForceTexts)[]) {
    force[key] = resolveValue(key, texts?.force?.[key], force[key], variables);
  }
  for (const key of Object.keys(
    warning
  ) as (keyof StoreVersionWarningTexts)[]) {
    warning[key] = resolveValue(
      key,
      texts?.warning?.[key],
      warning[key],
      variables
    );
  }
  return { force, warning };
};

// `{monthShort}` に入れる英語の月の名前。Intl（Intl.DateTimeFormat / toLocaleDateString）は使わない
// （古い Hermes には Intl が無いことがあり、あっても端末の言語で結果が変わる。書式は `texts` の言語に合わせる）
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// 1 回の replace で全部を扱う（閉じ括弧まで一致させるので、選択肢の順番には依存しない。String.prototype.replaceAll に頼らない）
const DATE_PLACEHOLDER = /\{(year|monthShort|month|day)\}/g;

/**
 * 公開日（ISO 8601）に書式（`texts.*.releaseDate`）を当てる。`{year}`（4 桁）/ `{month}`（1〜12）/
 * `{monthShort}`（英語の 3 文字。Jan〜Dec）/ `{day}`（1〜31）のすべての出現を置き換える。日付は端末のタイムゾーンで読む。
 * 公開日が無い・日付として読めないときは undefined（公開日を出さない）。パッケージの入口からは export しない
 */
export const formatReleaseDate = (
  format: string,
  releaseDate: string | undefined
): string | undefined => {
  if (releaseDate === undefined) {
    return undefined;
  }
  const date = new Date(releaseDate);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const values: Record<string, string> = {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1),
    monthShort: MONTHS_SHORT[date.getMonth()],
    day: String(date.getDate()),
  };
  return format.replace(DATE_PLACEHOLDER, (_match, key: string) => values[key]);
};
