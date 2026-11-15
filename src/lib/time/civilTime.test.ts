import { describe, expect, it } from 'vitest';
import { civilFromDays, daysFromCivil } from './civilTime';

describe('Date に依存しない暦の変換', () => {
  it('紀元前・西暦0年・世紀のうるう年をネイティブの日付と照合する', () => {
    for (const y of [-400, -1, 0, 1, 99, 400, 1900, 2000, 275759]) {
      for (let mo = 1; mo <= 12; mo++) {
        const date = new Date(0);
        date.setUTCFullYear(y, mo - 1, 28);
        const days = date.getTime() / 86400000;
        expect(daysFromCivil(y, mo, 28)).toBe(days);
        expect(civilFromDays(days)).toEqual({ y, mo, d: 28 });
      }
    }
    expect(civilFromDays(daysFromCivil(2024, 2, 30))).toEqual({ y: 2024, mo: 3, d: 1 });
    expect(civilFromDays(daysFromCivil(1900, 2, 29))).toEqual({ y: 1900, mo: 3, d: 1 });
  });

  it('Date の両端と、その1日外側の壁時計の日付を表せる', () => {
    for (const [days, date] of [
      [-100000001, { y: -271821, mo: 4, d: 19 }],
      [-100000000, { y: -271821, mo: 4, d: 20 }],
      [100000000, { y: 275760, mo: 9, d: 13 }],
      [100000001, { y: 275760, mo: 9, d: 14 }],
    ] as const) {
      expect(civilFromDays(days)).toEqual(date);
      expect(daysFromCivil(date.y, date.mo, date.d)).toBe(days);
    }
  });
});
