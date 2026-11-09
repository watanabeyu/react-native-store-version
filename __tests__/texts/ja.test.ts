// 日本語プリセット（`react-native-store-version/texts/ja`。3b）: 4.3 の表 / Texts.dc.html の文言と完全一致、
// すべてのキーがある、resolveTexts にそのまま渡せる、Texts.dc.html の例のように一部だけ上書きできる
import { DEFAULT_TEXTS, resolveTexts } from '../../src/react/texts.ts';
import ja from '../../src/texts/ja.ts';

describe('texts/ja', () => {
  it('matches the Japanese column of the texts table (4.3 / Texts.dc.html)', () => {
    expect(ja).toEqual({
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
    });
  });

  it('has exactly the same keys as the English defaults', () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(DEFAULT_TEXTS).sort());
    expect(Object.keys(ja.force).sort()).toEqual(
      Object.keys(DEFAULT_TEXTS.force).sort()
    );
    expect(Object.keys(ja.warning).sort()).toEqual(
      Object.keys(DEFAULT_TEXTS.warning).sort()
    );
  });

  it('resolves to Japanese with {remote} replaced (no English left)', () => {
    const resolved = resolveTexts(ja, { local: '1.0.0', remote: '2.4.0' });
    expect(resolved).toEqual({
      force: {
        title: 'アップデートが必要です',
        message:
          '新しいバージョン（2.4.0）が公開されています。引き続きご利用いただくにはアップデートしてください。',
        update: 'アップデート',
      },
      warning: {
        title: '新しいバージョンがあります',
        message: 'バージョン 2.4.0 が利用できます。',
        update: 'アップデート',
        later: 'あとで',
      },
    });
  });

  it('reads naturally when remote is unknown (empty full-width parentheses removed. D53)', () => {
    const resolved = resolveTexts(ja, { local: '1.0.0', remote: null });
    expect(resolved.force.message).toBe(
      '新しいバージョンが公開されています。引き続きご利用いただくにはアップデートしてください。'
    );
    expect(resolved.warning.message).toBe('バージョン が利用できます。');
  });

  it('can be used as a base to change a part (Texts.dc.html example)', () => {
    const resolved = resolveTexts(
      { ...ja, force: { ...ja.force, title: '更新してください' } },
      { local: '1.0.0', remote: '2.4.0' }
    );
    expect(resolved.force.title).toBe('更新してください');
    expect(resolved.force.update).toBe('アップデート');
    expect(resolved.warning.later).toBe('あとで');
  });
});
