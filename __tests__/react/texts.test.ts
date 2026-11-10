// resolveTexts: 英語の既定値、force / warning ごとの 1 段のマージ、`{remote}` / `{local}` のすべての出現の置き換え
import {
  DEFAULT_TEXTS,
  resolveTexts,
  type StoreVersionTexts,
} from '../../src/react/texts.ts';

const versions = { local: '1.0.0', remote: '2.4.0' };

describe('DEFAULT_TEXTS', () => {
  it('matches the English defaults', () => {
    expect(DEFAULT_TEXTS).toEqual({
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
    });
  });
});

describe('resolveTexts', () => {
  it('returns the defaults with {remote} replaced when texts is undefined', () => {
    expect(resolveTexts(undefined, versions)).toEqual({
      force: {
        title: 'Update required',
        message:
          'A new version (2.4.0) is available. Please update to continue using the app.',
        update: 'Update',
      },
      warning: {
        title: 'Update available',
        message: 'Version 2.4.0 is now available.',
        update: 'Update',
        later: 'Later',
      },
    });
  });

  it('does not mutate DEFAULT_TEXTS', () => {
    const before = JSON.stringify(DEFAULT_TEXTS);
    const resolved = resolveTexts({ force: { title: 'x' } }, versions);
    resolved.force.title = 'changed';
    resolved.warning.later = 'changed';
    expect(JSON.stringify(DEFAULT_TEXTS)).toBe(before);
  });

  it('fills the keys not given per section (one level merge)', () => {
    const texts: StoreVersionTexts = {
      force: { title: 'Please update' },
      warning: { later: 'Not now' },
    };
    const resolved = resolveTexts(texts, versions);
    expect(resolved.force).toEqual({
      title: 'Please update',
      message:
        'A new version (2.4.0) is available. Please update to continue using the app.',
      update: 'Update',
    });
    expect(resolved.warning).toEqual({
      title: 'Update available',
      message: 'Version 2.4.0 is now available.',
      update: 'Update',
      later: 'Not now',
    });
  });

  it('treats an explicit undefined and an empty section as not given', () => {
    const resolved = resolveTexts(
      { force: { title: undefined, update: undefined }, warning: {} },
      versions
    );
    expect(resolved.force.title).toBe('Update required');
    expect(resolved.force.update).toBe('Update');
    expect(resolved.warning).toEqual(resolveTexts(undefined, versions).warning);
  });

  it('keeps an empty string given on purpose', () => {
    expect(
      resolveTexts({ warning: { later: '' } }, versions).warning.later
    ).toBe('');
  });

  it('replaces every occurrence of {remote} and {local} in every key', () => {
    const resolved = resolveTexts(
      {
        force: {
          title: '{local} → {remote}',
          message: '{remote} {remote} ({local}, {local})',
          update: 'Get {remote}',
        },
        warning: {
          title: '{remote}',
          message: 'You have {local}. {remote} is out.',
          update: 'Update to {remote}',
          later: 'Stay on {local}',
        },
      },
      versions
    );
    expect(resolved).toEqual({
      force: {
        title: '1.0.0 → 2.4.0',
        message: '2.4.0 2.4.0 (1.0.0, 1.0.0)',
        update: 'Get 2.4.0',
      },
      warning: {
        title: '2.4.0',
        message: 'You have 1.0.0. 2.4.0 is out.',
        update: 'Update to 2.4.0',
        later: 'Stay on 1.0.0',
      },
    });
  });

  describe('a null value (remote unknown with a minimum-version force)', () => {
    const unknown = { local: '1.0.0', remote: null };

    it('removes the empty parentheses and the surplus space from the English defaults', () => {
      expect(resolveTexts(undefined, unknown).force.message).toBe(
        'A new version is available. Please update to continue using the app.'
      );
      expect(resolveTexts(undefined, unknown).warning.message).toBe(
        'Version is now available.'
      );
    });

    it('removes full-width empty parentheses too (Japanese)', () => {
      expect(
        resolveTexts(
          {
            force: {
              message: '新しいバージョン（{remote}）が公開されています。',
            },
          },
          unknown
        ).force.message
      ).toBe('新しいバージョンが公開されています。');
    });

    it('just drops the placeholder when the text has no parentheses, collapsing double spaces and trimming', () => {
      expect(
        resolveTexts({ force: { title: 'Get {remote} now' } }, unknown).force
          .title
      ).toBe('Get now');
      expect(
        resolveTexts({ force: { title: '{remote} is out' } }, unknown).force
          .title
      ).toBe('is out');
      expect(
        resolveTexts({ force: { title: 'Update to {remote}' } }, unknown).force
          .title
      ).toBe('Update to');
      expect(
        resolveTexts({ force: { title: 'v{remote}' } }, unknown).force.title
      ).toBe('v');
    });

    it('treats a null local the same way', () => {
      expect(
        resolveTexts(
          { force: { message: 'From {local} ({local}) to {remote}' } },
          { local: null, remote: '2.4.0' }
        ).force.message
      ).toBe('From to 2.4.0');
    });

    it('does not touch parentheses or spaces that are not caused by the empty value', () => {
      expect(
        resolveTexts(
          { force: { title: '()  (x) {remote}（）' } },
          { local: '1.0.0', remote: '2.4.0' }
        ).force.title
      ).toBe('()  (x) 2.4.0（）');
      // 値が無いキーの文言は変えない（プレースホルダーを含むキーだけを整える）
      expect(
        resolveTexts({ force: { title: 'a  () b' } }, unknown).force.title
      ).toBe('a  () b');
    });
  });

  it('falls back to the default when a value is not a string (JS callers)', () => {
    const broken = {
      force: { title: 123, message: null, update: undefined },
      warning: { later: ['x'], title: '' },
    } as unknown as StoreVersionTexts;
    const resolved = resolveTexts(broken, versions);
    expect(resolved.force).toEqual(resolveTexts(undefined, versions).force);
    expect(resolved.warning.later).toBe('Later');
    expect(resolved.warning.title).toBe('');
  });

  it('replaces in a single pass: a value that contains a placeholder is not replaced again', () => {
    const resolved = resolveTexts(
      { force: { title: '{remote} / {local}' } },
      { local: '{remote}', remote: '{local}' }
    );
    expect(resolved.force.title).toBe('{local} / {remote}');
  });

  it('removes only the parentheses that wrapped the empty placeholder, not unrelated ones', () => {
    expect(
      resolveTexts(
        {
          force: { message: 'Call () later ({remote}) and keep (this). （）' },
        },
        { local: '1.0.0', remote: null }
      ).force.message
    ).toBe('Call () later and keep (this). （）');
    expect(
      resolveTexts(
        { force: { message: 'A（{remote}）B (x {remote}) C' } },
        { local: '1.0.0', remote: null }
      ).force.message
    ).toBe('AB (x ) C');
  });

  it('does not treat the replaced value as a pattern ($& and the like)', () => {
    expect(
      resolveTexts(
        { force: { title: '{remote}' } },
        { local: '1.0.0', remote: '$&-$1' }
      ).force.title
    ).toBe('$&-$1');
  });
});
