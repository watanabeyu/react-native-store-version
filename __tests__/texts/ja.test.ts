// 日本語プリセット（`react-native-store-version/texts/ja`）: 元のデザインの日本語の文言と完全一致、
// すべてのキーがある、resolveTexts にそのまま渡せる、README の例のように一部だけ上書きできる
import { DEFAULT_TEXTS, resolveTexts } from '../../src/react/texts.ts';
import ja, * as jaModule from '../../src/texts/ja.ts';

describe('texts/ja', () => {
  it('matches the Japanese preset', () => {
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

  it('is the only export of the module (default export, no named export)', () => {
    expect(Object.keys(jaModule)).toEqual(['default']);
    expect(jaModule.default).toBe(ja);
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

  it('reads naturally when remote is unknown (empty full-width parentheses removed)', () => {
    const resolved = resolveTexts(ja, { local: '1.0.0', remote: null });
    expect(resolved.force.message).toBe(
      '新しいバージョンが公開されています。引き続きご利用いただくにはアップデートしてください。'
    );
    expect(resolved.warning.message).toBe('バージョン が利用できます。');
  });

  it('can be used as a base to change a part (the README example)', () => {
    const resolved = resolveTexts(
      { ...ja, force: { ...ja.force, title: '更新してください' } },
      { local: '1.0.0', remote: '2.4.0' }
    );
    expect(resolved.force.title).toBe('更新してください');
    expect(resolved.force.update).toBe('アップデート');
    expect(resolved.warning.later).toBe('あとで');
  });
});
