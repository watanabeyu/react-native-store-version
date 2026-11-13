// resolveTexts: 英語の既定値、force / warning ごとの 1 段のマージ、`{remote}` / `{local}` のすべての出現の置き換え。
// formatReleaseDate: 公開日の書式（日付は端末のタイムゾーンでの正午にして、どのタイムゾーンでも同じ日になるようにする）
import {
  DEFAULT_TEXTS,
  formatReleaseDate,
  resolveTexts,
  type StoreVersionTexts,
} from '../../src/react/texts.ts';
import { localNoon } from '../__helpers__/date.ts';

const versions = { local: '1.0.0', remote: '2.4.0' };

describe('DEFAULT_TEXTS', () => {
  it('matches the English defaults', () => {
    expect(DEFAULT_TEXTS).toEqual({
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
        whatsNew: "What's new",
        releaseDate: '{monthShort} {day}, {year}',
      },
      warning: {
        title: 'Update available',
        message: 'Version 2.4.0 is now available.',
        update: 'Update',
        later: 'Later',
        whatsNew: "What's new",
        releaseDate: '{monthShort} {day}, {year}',
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
      whatsNew: "What's new",
      releaseDate: '{monthShort} {day}, {year}',
    });
    expect(resolved.warning).toEqual({
      title: 'Update available',
      message: 'Version 2.4.0 is now available.',
      update: 'Update',
      later: 'Not now',
      whatsNew: "What's new",
      releaseDate: '{monthShort} {day}, {year}',
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
        whatsNew: "What's new",
        releaseDate: '{monthShort} {day}, {year}',
      },
      warning: {
        title: '2.4.0',
        message: 'You have 1.0.0. 2.4.0 is out.',
        update: 'Update to 2.4.0',
        later: 'Stay on 1.0.0',
        whatsNew: "What's new",
        releaseDate: '{monthShort} {day}, {year}',
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

describe('resolveTexts: whatsNew and releaseDate', () => {
  it('merges whatsNew alone, keeping the other defaults', () => {
    const resolved = resolveTexts(
      { force: { whatsNew: 'Release notes' } },
      versions
    );
    expect(resolved.force).toEqual({
      ...resolveTexts(undefined, versions).force,
      whatsNew: 'Release notes',
    });
    expect(resolved.warning).toEqual(resolveTexts(undefined, versions).warning);
  });

  it('replaces {remote} / {local} in whatsNew like the other keys', () => {
    const resolved = resolveTexts(
      {
        force: { whatsNew: 'New in {remote}' },
        warning: { whatsNew: 'Since {local}' },
      },
      versions
    );
    expect(resolved.force.whatsNew).toBe('New in 2.4.0');
    expect(resolved.warning.whatsNew).toBe('Since 1.0.0');
  });

  it('keeps releaseDate as a format: {remote} / {local} and the date placeholders are left as written', () => {
    const resolved = resolveTexts(
      {
        force: { releaseDate: '{remote} ({local}) {day}.{month}.{year}' },
        warning: { releaseDate: '{year}/{month}/{day} {remote}' },
      },
      versions
    );
    expect(resolved.force.releaseDate).toBe(
      '{remote} ({local}) {day}.{month}.{year}'
    );
    expect(resolved.warning.releaseDate).toBe('{year}/{month}/{day} {remote}');
  });

  it('does not clean up a releaseDate format when a version is null', () => {
    expect(
      resolveTexts(
        { force: { releaseDate: '{year}  ({remote})' } },
        { local: '1.0.0', remote: null }
      ).force.releaseDate
    ).toBe('{year}  ({remote})');
  });

  it('merges releaseDate alone, and falls back to the defaults for non-strings (JS callers)', () => {
    expect(
      resolveTexts({ warning: { releaseDate: '{year}' } }, versions).warning
    ).toEqual({
      ...resolveTexts(undefined, versions).warning,
      releaseDate: '{year}',
    });
    const broken = {
      force: { whatsNew: 1, releaseDate: null },
      warning: { whatsNew: {}, releaseDate: 20261105 },
    } as unknown as StoreVersionTexts;
    expect(resolveTexts(broken, versions)).toEqual(
      resolveTexts(undefined, versions)
    );
  });
});

describe('formatReleaseDate', () => {
  it('applies the English default and the Japanese format', () => {
    expect(
      formatReleaseDate(DEFAULT_TEXTS.force.releaseDate, localNoon(2026, 11, 5))
    ).toBe('Nov 5, 2026');
    expect(
      formatReleaseDate('{year}年{month}月{day}日', localNoon(2026, 11, 5))
    ).toBe('2026年11月5日');
  });

  it('replaces each placeholder: {year} 4 digits, {month} 1-12, {monthShort} Jan-Dec, {day} 1-31 (no zero padding)', () => {
    const date = localNoon(2026, 3, 9);
    expect(formatReleaseDate('{year}', date)).toBe('2026');
    expect(formatReleaseDate('{month}', date)).toBe('3');
    expect(formatReleaseDate('{monthShort}', date)).toBe('Mar');
    expect(formatReleaseDate('{day}', date)).toBe('9');
  });

  it('names every month, including the first and the last day of the year', () => {
    const names = [
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
    names.forEach((name, index) => {
      expect(
        formatReleaseDate(
          '{monthShort} {month}',
          localNoon(2026, index + 1, 15)
        )
      ).toBe(`${name} ${index + 1}`);
    });
    expect(
      formatReleaseDate('{monthShort} {day}, {year}', localNoon(2026, 1, 1))
    ).toBe('Jan 1, 2026');
    expect(
      formatReleaseDate('{year}/{month}/{day}', localNoon(2026, 12, 31))
    ).toBe('2026/12/31');
  });

  it('replaces every occurrence and leaves everything else as written', () => {
    expect(
      formatReleaseDate(
        '{day}-{day} {month}{monthShort} {remote} {Year} {hour} {year}',
        localNoon(2026, 11, 5)
      )
    ).toBe('5-5 11Nov {remote} {Year} {hour} 2026');
    expect(formatReleaseDate('Released', localNoon(2026, 11, 5))).toBe(
      'Released'
    );
    expect(formatReleaseDate('', localNoon(2026, 11, 5))).toBe('');
  });

  it('reads the date in the time zone of the device (getFullYear / getMonth / getDate)', () => {
    jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2027);
    jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(0);
    jest.spyOn(Date.prototype, 'getDate').mockReturnValue(1);
    expect(
      formatReleaseDate('{monthShort} {day}, {year}', '2026-12-31T23:30:00Z')
    ).toBe('Jan 1, 2027');
  });

  it('returns undefined when there is no date or it cannot be read', () => {
    expect(formatReleaseDate('{year}', undefined)).toBeUndefined();
    expect(formatReleaseDate('{year}', 'not a date')).toBeUndefined();
    expect(formatReleaseDate('{year}', '')).toBeUndefined();
    expect(formatReleaseDate('no placeholder', 'not a date')).toBeUndefined();
  });

  it('does not use Intl', () => {
    const format = jest.spyOn(Intl, 'DateTimeFormat');
    const locale = jest.spyOn(Date.prototype, 'toLocaleDateString');
    formatReleaseDate('{monthShort} {day}, {year}', localNoon(2026, 11, 5));
    expect(format).not.toHaveBeenCalled();
    expect(locale).not.toHaveBeenCalled();
  });
});
