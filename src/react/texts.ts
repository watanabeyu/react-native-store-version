// デフォルト UI の文言（4.3）。型、英語の既定値、既定値との 1 段のマージと `{remote}` / `{local}` の置き換え。
// React に依存しない純粋な関数にして、デフォルト UI と `components` の両方がこの結果を受け取る。
// 日本語のプリセットは src/texts/ja.ts（`react-native-store-version/texts/ja`。D8）

/** Force（強制アップデート）の文言。`{remote}`（最新バージョン）/ `{local}`（現在のバージョン）は表示時に置き換える */
export type StoreVersionForceTexts = {
  title: string;
  message: string;
  /** 更新ボタン */
  update: string;
};

/** Warning（閉じられるボトムシート）の文言。`{remote}` / `{local}` は表示時に置き換える */
export type StoreVersionWarningTexts = {
  title: string;
  message: string;
  /** 更新ボタン */
  update: string;
  /** 「あとで」ボタン */
  later: string;
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

/** 英語の既定値（4.3 の表。Texts.dc.html と同じ文言） */
export const DEFAULT_TEXTS: StoreVersionResolvedTexts = {
  force: {
    title: 'Update required',
    message:
      'A new version ({remote}) is available. Please update to continue using the app.',
    update: 'Update',
  },
  warning: {
    title: 'Update available',
    message: 'Version {remote} is now available.',
    update: 'Update',
    later: 'Later',
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

// `{remote}` / `{local}` のすべての出現を置き換える（D53）。値が null（Play の版が比較できず、最低バージョンで force になったとき）は
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

/**
 * Provider の `texts` を表示用の文言にする。`force` / `warning` ごとに、指定しなかったキー（文字列でない値も）を英語の既定値で
 * 補完し（1 段だけマージ）、`{remote}` / `{local}` のすべての出現を置き換える。
 * `texts` / `local` / `remote` が変わるたびに呼ぶ（`texts` の変更を表示中のモーダルにも即座に反映するため。D26）
 */
export const resolveTexts = (
  texts: StoreVersionTexts | undefined,
  variables: TextVariables
): StoreVersionResolvedTexts => {
  const force = { ...DEFAULT_TEXTS.force };
  const warning = { ...DEFAULT_TEXTS.warning };
  for (const key of Object.keys(force) as (keyof StoreVersionForceTexts)[]) {
    force[key] = fill(
      textOrDefault(texts?.force?.[key], force[key]),
      variables
    );
  }
  for (const key of Object.keys(
    warning
  ) as (keyof StoreVersionWarningTexts)[]) {
    warning[key] = fill(
      textOrDefault(texts?.warning?.[key], warning[key]),
      variables
    );
  }
  return { force, warning };
};
