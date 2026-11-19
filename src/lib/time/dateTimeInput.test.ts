import { describe, expect, it } from 'vitest';
import { DateRangeError, NonexistentTimeError } from './timezone';
import { parseDateTime } from './dateTimeInput';
import { formatJstLabeled, formatWithOffset, showsMillis } from './dateTimeFormat';

/**
 * 日時の入力解析（parseDateTime）のテスト。UNIX時間・cron の画面はこれを使う。
 *
 * @remarks
 * 表示（dateTimeFormat.ts）の出力を解析で読み戻せること（往復）も、このファイルで確かめる
 * （表示した日時を日時入力に貼り戻しても同じ時刻になることは、解析の側の契約のため）。
 */

it('ミリ秒を付けた日本時間の表示（formatJstLabeled）を、同じ時刻に読み戻す', () => {
  for (const iso of ['2026-01-01T00:00:00.123Z', '1969-12-31T23:59:59.999Z']) {
    const date = new Date(iso);
    expect(parseDateTime(formatJstLabeled(date, showsMillis(date)), 'UTC'), iso).toEqual(date);
  }
});

describe('曜日の添え書き', () => {
  it('「（月）」「(月)」を読み飛ばし、オフセットやタイムゾーンの前後どちらにあっても読む', () => {
    const expected = new Date('2026-10-05T00:00:00Z');
    for (const text of ['2026-10-05 09:00:00（月）', '2026-10-05 09:00:00 (月)', '2026-10-05 09:00:00（月） JST', '2026-10-05 00:00:00 +00:00（月）']) {
      expect(parseDateTime(text, 'Asia/Tokyo'), text).toEqual(expected);
    }
  });

  it('曜日が日付と合わなければ、黙って読まずにエラーにする', () => {
    expect(() => parseDateTime('2026-10-05 09:00:00（火）', 'Asia/Tokyo')).toThrow('曜日（火）が日付と合いません');
  });

  it('曜日でない括弧書きは読まない', () => {
    expect(() => parseDateTime('2026-10-05 09:00:00（JST）', 'Asia/Tokyo')).toThrow();
  });
});

it('秒を含む歴史的なオフセットを保持して読み戻す', () => {
  const date = new Date('1880-01-01T00:00:00Z');
  const shown = formatWithOffset(date, 'Asia/Tokyo');
  expect(shown).toBe('1880-01-01 09:18:59 +09:18:59');
  expect(parseDateTime(shown, 'UTC')).toEqual(date);
});

describe('parseDateTime', () => {
  it.each([-8640000000000000, -62198755200000, 253402300800000, 8640000000000000])('拡張年の ISO 出力を読み戻す：%s', (ms) => {
    expect(parseDateTime(new Date(ms).toISOString(), 'Asia/Tokyo').getTime()).toBe(ms);
  });

  it('拡張年でも日付・年の表記・日時の範囲を検証する', () => {
    expect(parseDateTime('+010000-02-29T09:00:00+09:00', 'UTC').toISOString()).toBe('+010000-02-29T00:00:00.000Z');
    for (const input of ['-000000-01-01T00:00:00Z', '+10000-01-01T00:00:00Z', '10000-01-01T00:00:00Z', '+010001-02-29T00:00:00Z', '+275760-09-13T00:00:00.001Z']) {
      expect(() => parseDateTime(input, 'UTC'), input).toThrow();
    }
  });

  it('自分の出力の形式を読み直せる', () => {
    const date = new Date(1700000000000);
    expect(parseDateTime(formatWithOffset(date, 'Asia/Tokyo'), 'UTC').getTime()).toBe(date.getTime());
    expect(parseDateTime(formatWithOffset(new Date(1700000000123), 'America/New_York', true), 'UTC').getTime()).toBe(1700000000123);
  });

  it('範囲の端と、0〜9999年の外の日時でも、オフセット付きの出力を読み直せる', () => {
    const dates = ['+275760-09-13T00:00:00.000Z', '-271821-04-20T00:00:00.000Z', '+010000-01-01T00:00:00.000Z', '-000001-06-01T00:00:00.000Z', '0500-01-01T00:00:00.000Z'];
    for (const iso of dates) {
      const date = new Date(iso);
      for (const zone of ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        const shown = formatWithOffset(date, zone, true);
        expect(shown, `${iso} ${zone}`).not.toContain('NaN');
        expect(parseDateTime(shown, 'UTC').getTime(), `${iso} ${zone} ${shown}`).toBe(date.getTime());
      }
    }
  });

  it('タイムゾーンで読むと範囲を超える壁時計は、範囲外のエラーにする', () => {
    expect(parseDateTime('+275760-09-13 09:00:00', 'Asia/Tokyo').toISOString()).toBe('+275760-09-13T00:00:00.000Z');
    expect(() => parseDateTime('+275760-09-13 09:00:01', 'Asia/Tokyo')).toThrow('日時の範囲を超えています');
    expect(() => parseDateTime('-271821-04-19 19:03:57', 'America/New_York')).toThrow('日時の範囲を超えています');
  });

  it('時だけのオフセットと、UTC・GMT・JST の表記を読む', () => {
    const expected = '2026-10-02T06:30:00.000Z';
    for (const s of ['2026-10-02 15:30:00+09', '2026-10-02 15:30:00 +0900', '2026-10-02 15:30:00 JST', '2026-10-02 15:30:00 jst']) {
      expect(parseDateTime(s, 'UTC').toISOString(), s).toBe(expected);
    }
    for (const s of ['2026-10-02 06:30:00 UTC', '2026-10-02 06:30:00 GMT', '2026-10-02 06:30:00 Z']) {
      expect(parseDateTime(s, 'Asia/Tokyo').toISOString(), s).toBe(expected);
    }
    expect(parseDateTime('2026-10-02 01:30:00-05', 'UTC').toISOString()).toBe(expected);
  });

  it('時刻のない日付の後ろの2桁は、オフセットと読まない', () => {
    expect(() => parseDateTime('2026-1-5-09', 'UTC')).toThrow('形式で入力してください');
  });

  it('オフセットの時・分の範囲外を拒否する', () => {
    for (const offset of ['+09:99', '+99:00', '-24:00', '+00:60', '-0960']) {
      expect(() => parseDateTime(`2026-01-01T00:00:00${offset}`, 'UTC'), offset).toThrow('オフセット');
    }
    expect(parseDateTime('2026-01-01T00:00:00+23:59', 'UTC').toISOString()).toBe('2025-12-31T00:01:00.000Z');
    expect(parseDateTime('2026-01-01T00:00:00-2359', 'UTC').toISOString()).toBe('2026-01-01T23:59:00.000Z');
    expect(parseDateTime('2026-01-01T00:00:00+0900', 'UTC').toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });

  it('タイムゾーンなしは指定ゾーンで解釈する', () => {
    expect(parseDateTime('2026-10-02 09:00', 'Asia/Tokyo').toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(parseDateTime('2026/10/02 09:00:00', 'UTC').toISOString()).toBe('2026-10-02T09:00:00.000Z');
  });

  it('日付のみも受け付ける', () => {
    expect(parseDateTime('2026-1-5', 'Asia/Tokyo').toISOString()).toBe('2026-01-04T15:00:00.000Z');
  });

  it('ISO8601のオフセットを優先する', () => {
    expect(parseDateTime('2026-10-02T09:00:00Z', 'Asia/Tokyo').toISOString()).toBe('2026-10-02T09:00:00.000Z');
  });

  it('不正な形式はエラー', () => {
    expect(() => parseDateTime('10月2日', 'UTC')).toThrow();
    expect(() => parseDateTime('2026-13-40', 'UTC')).toThrow();
  });

  it('存在しない日付を翌月に繰り上げずにエラーにする', () => {
    for (const s of ['2026-02-29 12:00', '2026-04-31', '2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '2100-02-29']) {
      expect(() => parseDateTime(s, 'UTC'), s).toThrow('存在しない日付です');
    }
  });

  it('存在しない時刻を翌日に繰り上げずにエラーにする', () => {
    expect(() => parseDateTime('2026-01-01 24:00', 'UTC')).toThrow('存在しない時刻です');
    expect(() => parseDateTime('2026-01-01 23:60', 'UTC')).toThrow('存在しない時刻です');
    expect(() => parseDateTime('2026-01-01 23:59:60', 'UTC')).toThrow('存在しない時刻です');
  });

  it('うるう年の2月29日は受け付ける', () => {
    expect(parseDateTime('2024-02-29', 'UTC').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseDateTime('2000-02-29 23:59:59', 'UTC').toISOString()).toBe('2000-02-29T23:59:59.000Z');
  });
});

describe('タイムゾーンを指定した解析', () => {
  it('任意のタイムゾーンの時刻として解釈する', () => {
    expect(parseDateTime('2024-07-01 09:00', 'America/New_York').toISOString()).toBe('2024-07-01T13:00:00.000Z');
    expect(parseDateTime('2024-01-01 09:00', 'Europe/London').toISOString()).toBe('2024-01-01T09:00:00.000Z');
    expect(() => parseDateTime('2024-01-01', 'Mars/Olympus')).toThrow('タイムゾーン「Mars/Olympus」が見つかりません');
  });

  it('夏時間で飛ばされる時刻はエラー、2回ある時刻は先のほう', () => {
    expect(() => parseDateTime('2024-03-10 02:30', 'America/New_York')).toThrow('存在しない時刻です');
    expect(parseDateTime('2024-11-03 01:30', 'America/New_York').toISOString()).toBe('2024-11-03T05:30:00.000Z');
  });

  it('0〜99年とミリ秒も扱う', () => {
    expect(parseDateTime('0050-01-01 00:00', 'UTC').getUTCFullYear()).toBe(50);
    expect(parseDateTime('2024-01-01T00:00:00.123Z', 'UTC').getTime() % 1000).toBe(123);
  });
});

describe('表示との往復', () => {
  it('精度の決め方に従った表示は、どの日時・タイムゾーンでも日時入力で同じ時刻に読み戻せる', () => {
    const times = [1700000000123, 1700000000000, -1, -62198755199999, 8.64e15, -8.64e15, 253402300800001];
    for (const ms of times) {
      for (const zone of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
        for (const subSecondInput of [false, true]) {
          const date = new Date(ms);
          const shown = formatWithOffset(date, zone, showsMillis(date, subSecondInput));
          expect(parseDateTime(shown, 'UTC').getTime(), `${ms} ${zone} ${shown}`).toBe(ms);
        }
      }
    }
  });
});

describe('日時の失敗の種類', () => {
  it('範囲外と、夏時間で飛ばされる時刻を、例外の種類で区別する', () => {
    expect(() => parseDateTime('+275760-09-13 09:00:01', 'Asia/Tokyo')).toThrow(DateRangeError);
    expect(() => parseDateTime('2026-03-08 02:30', 'America/New_York')).toThrow(NonexistentTimeError);
    expect(() => parseDateTime('2026-03-08 02:30', 'America/New_York')).not.toThrow(DateRangeError);
  });
});
