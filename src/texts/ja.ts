// 日本語の文言プリセット（文言のモックと同じ文言）。`react-native-store-version/texts/ja` で読む。
// default export にしている（文言のモックのコード例 `import ja from 'react-native-store-version/texts/ja'` のとおり）。
// 型はすべてのキーが埋まった StoreVersionResolvedTexts なので、`{ ...ja, force: { ...ja.force, title: '...' } }` のように
// 日本語をベースに一部だけ変えられる
import type { StoreVersionResolvedTexts } from '../react/texts.ts';

/**
 * 日本語の文言。`<StoreVersionProvider texts={ja}>` で使う。
 * `{remote}`（最新バージョン）/ `{local}`（現在のバージョン）は表示時に置き換わる
 */
const ja: StoreVersionResolvedTexts = {
  force: {
    title: 'アップデートが必要です',
    message:
      '新しいバージョン（{remote}）が公開されています。引き続きご利用いただくにはアップデートしてください。',
    update: 'アップデート',
  },
  warning: {
    title: '新しいバージョンがあります',
    message: 'バージョン {remote} が利用できます。',
    update: 'アップデート',
    later: 'あとで',
  },
};

export default ja;
