// 公開日のテスト用。端末のタイムゾーンでの正午を、ライブラリが返す形（ISO 8601 の UTC で秒まで）にする。
// 端末のタイムゾーンで読むと、どのタイムゾーン（UTC-12〜UTC+14）でも指定した日になる
export const localNoon = (year: number, month: number, day: number): string =>
  new Date(year, month - 1, day, 12).toISOString().replace(/\.\d+Z$/, 'Z');
