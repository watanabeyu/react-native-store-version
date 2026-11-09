// デフォルト UI の文言（4.3）の型。3a では型だけを置く（英語の既定値と、既定値との 1 段のマージ・`{remote}` / `{local}` の
// 置き換えは 3b でここに足す）

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
