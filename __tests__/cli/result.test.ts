/**
 * @jest-environment node
 */
// 指摘の件数と終了コード（error で 1、--strict なら warning でも 1、info は常に 0）
import {
  type CheckEntry,
  countEntries,
  exitCodeOf,
  type Level,
} from '../../src/cli/result.ts';

const entries = (...levels: Level[]): CheckEntry[] =>
  levels.map((level) => ({ id: 'C1', level, message: level }));

describe('countEntries', () => {
  it('counts error / warning / info, not ok / skipped', () => {
    expect(
      countEntries(
        entries('error', 'warning', 'warning', 'info', 'ok', 'skipped', 'info')
      )
    ).toEqual({ error: 1, warning: 2, info: 2 });
    expect(countEntries([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe('exitCodeOf', () => {
  it.each([
    [[], false, 0],
    [['ok', 'skipped'], true, 0],
    [['info'], false, 0],
    [['info'], true, 0],
    [['warning'], false, 0],
    [['warning'], true, 1],
    [['error'], false, 1],
    [['error'], true, 1],
    [['info', 'warning', 'error'], false, 1],
  ] as [Level[], boolean, number][])(
    '%j (strict: %s) → %d',
    (levels, strict, code) => {
      expect(exitCodeOf(countEntries(entries(...levels)), strict)).toBe(code);
    }
  );
});
