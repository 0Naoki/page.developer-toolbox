/** 検査の対象：logic.ts・epoch.ts（専用のテストファイルを置かないファイルも、ここでまとめて検査する） */
import { describe, expect, it, vi } from 'vitest';
import { addDuration, difference, parseDuration, toView } from './logic';
import { convertEpochsInText, parseAny, parseEpoch } from './epoch';
import { DateRangeError } from '../../lib/time/timezone';
import { parseDateTime } from '../../lib/time/dateTimeInput';
import { formatInZone, formatWithOffset } from '../../lib/time/dateTimeFormat';

describe('期間計算の日時範囲の境界', () => {
  it('暦日で一時的に範囲を超えても、経過時間を合算した結果が範囲内なら返す', () => {
    for (const zone of ['UTC', 'Asia/Tokyo', 'America/Phoenix']) {
      for (const sign of [-1, 1]) {
        const endpoint = sign * 8640000000000000;
        const duration = parseDuration(`${sign}d ${sign > 0 ? '-24' : '+24'}h`);
        expect(addDuration(new Date(endpoint), duration, zone).date.getTime()).toBe(endpoint);
        expect(addDuration(new Date(endpoint - sign), duration, zone).date.getTime()).toBe(endpoint - sign);
        expect(() => addDuration(new Date(endpoint), { ...duration, ms: duration.ms + sign }, zone)).toThrow(DateRangeError);
      }
    }
  });
  it('安全な整数を超える中間ミリ秒も、相殺後の1ミリ秒を丸めない', () => {
    const duration = parseDuration('200000000d -9007199254740991ms');
    expect(addDuration(new Date(0), duration, 'UTC').date.getTime()).toBe(Number(200000000n * 86400000n - 9007199254740991n));
    expect(addDuration(new Date(1), duration, 'UTC').date.getTime()).toBe(Number(200000000n * 86400000n - 9007199254740991n + 1n));
    expect(addDuration(new Date(8640000000000000), parseDuration('1mo -31d'), 'UTC').date.getTime()).toBe(8640000000000000 - 86400000);
  });
  for (const zone of ['UTC', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/Phoenix']) {
    for (const sign of [-1, 1]) {
      it(`${zone} で ${sign > 0 ? '上限' : '下限'} に暦日で到達できる`, () => {
        const endpoint = sign * 8640000000000000;
        const base = new Date(endpoint - sign * 86400000);
        expect(addDuration(base, parseDuration(`${sign}d`), zone)).toEqual({ date: new Date(endpoint), clamped: false });
        expect(() => addDuration(new Date(endpoint), parseDuration(`${sign}d`), zone)).toThrow(DateRangeError);
      });
    }
    it(`${zone} で年・月を足して上限に到達できる`, () => {
      for (const [base, duration] of [['+275760-08-13T00:00:00.000Z', '1mo'], ['+275759-09-13T00:00:00.000Z', '1y']] as const) {
        expect(addDuration(new Date(base), parseDuration(duration), zone).date.getTime()).toBe(8640000000000000);
      }
    });
  }
});

it('回帰：桁数だけでは単位を決めきれない値は、もう1つの読み方を返す（12桁のミリ秒を黙って秒として読まない）', () => {
  /** 1990-01-01 のミリ秒（12桁）を秒として読み、西暦2万年台の日時だけを表示していた */
  expect(parseEpoch('631152000000')).toMatchObject({ unit: 's', alternative: 'ms' });
  expect(parseEpoch('631152000000', 'ms').date.toISOString()).toBe('1990-01-01T00:00:00.000Z');
  expect(parseEpoch('63115200000')).toMatchObject({ unit: 's', alternative: 'ms' });
  expect(parseEpoch('631152000000000')).toMatchObject({ unit: 'ms', alternative: 'us' });
  expect(parseEpoch('631152000000000000')).toMatchObject({ unit: 'us', alternative: 'ns' });
  /** 今の時刻に近い桁数（10・13・16・19桁）や、単位を選んだときは、もう1つの読み方を返さない */
  for (const value of ['1790899200', '1790899200000', '1790899200000000', '1790899200000000000', '1500']) {
    expect(parseEpoch(value), value).not.toHaveProperty('alternative');
  }
  expect(parseEpoch('631152000000', 's')).not.toHaveProperty('alternative');
});

it('短いミリ秒値を、指定した単位で読み戻す', () => {
  const date = new Date('1970-01-01T00:00:01.500Z');
  expect(parseEpoch(String(toView(date).epochMillis), 'ms')).toEqual({ date, unit: 'ms' });
});

describe('parseEpoch', () => {
  it('明らかな範囲外の値から巨大な BigInt を作らない', () => {
    const construct = vi.spyOn(globalThis, 'BigInt');
    try {
      expect(() => parseEpoch('9'.repeat(1000000), 'ns')).toThrow('日時に変換できない値です');
      expect(construct.mock.calls.length).toBe(0);
    } finally { construct.mockRestore(); }
  });
  it('巨大な範囲外値を拒否し、長い先頭の0や小数部では有効な値を保つ', () => {
    for (const unit of ['auto', 's', 'ms', 'us', 'ns'] as const) {
      expect(() => parseEpoch('9'.repeat(1000000), unit)).toThrow('日時に変換できない値です');
    }
    expect(parseEpoch('0'.repeat(1000000) + '1', 's').date.getTime()).toBe(1000);
    expect(parseEpoch('1.001' + '9'.repeat(1000000), 's').date.getTime()).toBe(1001);
    for (const [unit, places] of [['s', 0], ['ms', 3], ['us', 6], ['ns', 9]] as const) {
      const bound = 8640000000000n * 10n ** BigInt(places);
      const step = places > 3 ? 10n ** BigInt(places - 3) : 1n;
      expect(parseEpoch(String(bound), unit).date.getTime()).toBe(8640000000000000);
      expect(() => parseEpoch(String(bound + step), unit)).toThrow('日時に変換できない値です');
    }
  });
  it('小数の秒を誤差なくミリ秒にし、ミリ秒未満は0方向に切り捨てる', () => {
    for (const [input, ms] of [
      ['1.001', 1001], ['1.003', 1003], ['-1.001', -1001],
      ['1.0019', 1001], ['-1.0019', -1001], ['0.0009', 0],
      ['0001.001', 1001], ['1700000000.1239', 1700000000123],
      ['1700000000123.9999', 1700000000123],
    ] as const) {
      expect(parseEpoch(input).date.getTime(), input).toBe(ms);
    }
  });

  it('10桁は秒として解釈する', () => {
    const r = parseEpoch('1700000000');
    expect(r.unit).toBe('s');
    expect(r.date.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('13桁はミリ秒として解釈する', () => {
    const r = parseEpoch('1700000000123');
    expect(r.unit).toBe('ms');
    expect(r.date.toISOString()).toBe('2023-11-14T22:13:20.123Z');
  });

  it('16桁はマイクロ秒、19桁はナノ秒として解釈する（ミリ秒として西暦5万年にしない）', () => {
    const us = parseEpoch('1700000000123456');
    expect(us.unit).toBe('us');
    expect(us.date.toISOString()).toBe('2023-11-14T22:13:20.123Z');
    const ns = parseEpoch('1700000000123456789');
    expect(ns.unit).toBe('ns');
    expect(ns.date.toISOString()).toBe('2023-11-14T22:13:20.123Z');
  });

  it('Number で丸められる桁数でも、ミリ秒の値と単位を変えない', () => {
    /** Number にすると 1700000000124000000 に丸められ、.124 になっていた */
    expect(parseEpoch('1700000000123999999').date.toISOString()).toBe('2023-11-14T22:13:20.123Z');
    expect(parseEpoch('1700000000123999').date.toISOString()).toBe('2023-11-14T22:13:20.123Z');
    /** 18桁は Number にすると 1e18 に丸められ、ナノ秒と判定されていた */
    const us = parseEpoch('999999999999999999');
    expect(us.unit).toBe('us');
    expect(us.date.toISOString()).toBe(new Date(999999999999999).toISOString());
    /** 先頭の0は桁数に数えない */
    expect(parseEpoch('0001700000000').unit).toBe('s');
    /** 負の値も 0 の方向へ切り捨てる（Date と同じ） */
    expect(parseEpoch('-1700000000123999999').date.toISOString()).toBe(new Date(-1700000000123).toISOString());
  });

  it('単位の境目の桁数と負の値', () => {
    expect(parseEpoch('999999999999').unit).toBe('s');
    expect(parseEpoch('999999999999999').unit).toBe('ms');
    expect(parseEpoch('-1700000000123456').unit).toBe('us');
    expect(parseEpoch('-1').date.toISOString()).toBe('1969-12-31T23:59:59.000Z');
  });

  it('数値以外はエラー', () => {
    expect(() => parseEpoch('abc')).toThrow();
  });
});

describe('toView', () => {
  it('JST・エポック秒・現在からの差を返す', () => {
    const v = toView(new Date('2026-10-02T00:00:00Z'), Date.parse('2026-10-02T00:00:00Z'));
    expect(v.jst).toBe('2026-10-02 09:00:00');
    expect(v.epochSeconds).toBe(1790899200);
    expect(v.relative).toBe('現在');
  });
});

describe('parseAny', () => {
  it('now・エポック時間・日時のどれでも読む', () => {
    expect(parseAny('now', 'UTC', 5000).getTime()).toBe(5000);
    expect(parseAny('現在', 'UTC', 5000).getTime()).toBe(5000);
    expect(parseAny('1700000000', 'UTC', 0).getTime()).toBe(1700000000_000);
    expect(parseAny('2024-01-01', 'UTC', 0).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('difference', () => {
  const a = new Date('2024-01-01T00:00:00Z');
  it('日・時間・分・秒・ミリ秒に分けて表す', () => {
    const b = new Date(a.getTime() + 2 * 86400000 + 3 * 3600000 + 4 * 60000 + 5 * 1000 + 6);
    const d = difference(a, b);
    expect(d.text).toBe('2日 3時間 4分 5秒 6ミリ秒');
    expect(d.totalHours).toBeCloseTo(51.0681, 3);
    expect(difference(b, a).text).toBe('−2日 3時間 4分 5秒 6ミリ秒');
    expect(difference(a, a).text).toBe('0秒');
  });

  it('Date の範囲の両端の差も、ミリ秒まで丸めずに表す', () => {
    const first = new Date('-271821-04-20T00:00:00.000Z');
    const last = new Date('+275760-09-12T23:59:59.999Z');
    expect(difference(first, last).text).toBe('199999999日 23時間 59分 59秒 999ミリ秒');
    expect(difference(last, first).text).toBe('−199999999日 23時間 59分 59秒 999ミリ秒');
    expect(difference(first, new Date('+275760-09-13T00:00:00.000Z')).text).toBe('200000000日');
  });
});

describe('parseDuration', () => {
  it('大きな期間を単位ごとに合算してから数値に戻し、差の1ミリ秒を保つ', () => {
    const duration = parseDuration('9007199254740993ms -9007199254740992ms');
    expect(duration).toEqual({ years: 0, months: 0, days: 0, ms: 1 });
    expect(addDuration(new Date('2026-01-01T00:00:00Z'), duration, 'UTC').date.toISOString()).toBe('2026-01-01T00:00:00.001Z');
    expect(parseDuration('-9007199254740993ms +9007199254740992ms').ms).toBe(-1);
    expect(parseDuration('9007199254741s -9007199254741000ms').ms).toBe(0);
    expect(parseDuration('9007199254740993y -9007199254740992y').years).toBe(1);
  });

  it('合算しても安全な整数範囲を超える期間と、長すぎる入力は断る', () => {
    expect(parseDuration('9007199254740991ms').ms).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseDuration('9007199254740992ms')).toThrow('期間の値が大きすぎます');
    expect(() => parseDuration('9007199254741h')).toThrow('期間の値が大きすぎます');
    expect(parseDuration('0'.repeat(997) + '1ms').ms).toBe(1);
    expect(() => parseDuration('1d '.repeat(334))).toThrow('期間は1,000単位まで');
  });
  it('英字・日本語の単位と、符号を読む', () => {
    expect(parseDuration('+1d 2h 30m')).toEqual({ years: 0, months: 0, days: 1, ms: 9000000 });
    expect(parseDuration('-1d 2h')).toEqual({ years: 0, months: 0, days: -1, ms: -7200000 });
    expect(parseDuration('1年2ヶ月')).toEqual({ years: 1, months: 2, days: 0, ms: 0 });
    expect(parseDuration('2w')).toEqual({ years: 0, months: 0, days: 14, ms: 0 });
    expect(parseDuration('90分')).toEqual({ years: 0, months: 0, days: 0, ms: 5400000 });
    expect(parseDuration('1d, -3h 500ms')).toEqual({ years: 0, months: 0, days: 1, ms: -10800000 - 500 });
    expect(parseDuration('1MO')).toEqual({ years: 0, months: 1, days: 0, ms: 0 });
  });

  it('読めない期間はエラー', () => {
    expect(() => parseDuration('')).toThrow('期間を入力してください');
    expect(() => parseDuration('1 day')).toThrow('の形で入力してください');
    expect(() => parseDuration('abc')).toThrow();
  });
});

describe('addDuration', () => {
  it('年と月の大きな加減算でも月のずれを丸めない', () => {
    const duration = parseDuration('750599937895083y -9007199254740991mo');
    expect(addDuration(new Date('2026-01-01T00:00:00Z'), duration, 'UTC').date.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
  it('月を足して、その日がなければ月末にそろえる', () => {
    const r = addDuration(parseDateTime('2024-01-31 09:00', 'Asia/Tokyo'), parseDuration('1mo'), 'Asia/Tokyo');
    expect(formatWithOffset(r.date, 'Asia/Tokyo')).toBe('2024-02-29 09:00:00 +09:00');
    expect(r.clamped).toBe(true);
    expect(addDuration(parseDateTime('2024-02-29', 'UTC'), parseDuration('1y'), 'UTC').date.toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('日は暦で足し（夏時間をまたいでも同じ時刻）、時間は経過時間で足す', () => {
    const base = parseDateTime('2024-03-09 12:00', 'America/New_York');
    expect(formatWithOffset(addDuration(base, parseDuration('1d'), 'America/New_York').date, 'America/New_York')).toBe('2024-03-10 12:00:00 -04:00');
    expect(formatWithOffset(addDuration(base, parseDuration('24h'), 'America/New_York').date, 'America/New_York')).toBe('2024-03-10 13:00:00 -04:00');
  });

  it('負の期間で前にさかのぼる', () => {
    const r = addDuration(new Date('2024-03-01T00:00:00Z'), parseDuration('-1d -1ms'), 'UTC');
    expect(r.date.toISOString()).toBe('2024-02-28T23:59:59.999Z');
    expect(r.clamped).toBe(false);
  });

  it('範囲を超えるとエラー', () => {
    expect(() => addDuration(new Date(0), parseDuration('300000y'), 'UTC')).toThrow('日時の範囲を超えています');
  });
});

describe('convertEpochsInText', () => {
  it('一括変換の整数部は、符号と小数部を除き先頭の0も数える', () => {
    expect(convertEpochsInText('0001700000000 -0001700000000.9', 'UTC', 'replace')).toEqual({
      output: '1970-01-20 16:13:20.000 +00:00 1969-12-12 07:46:40.000 +00:00',
      count: 2,
    });
  });

  it('紀元前や年が4桁に満たない日時も、ISO8601 と同じ年で表示する', () => {
    const shown = (epoch: string) => {
      const { date } = parseEpoch(epoch);
      return [formatInZone(date, 'UTC'), date.toISOString()];
    };
    expect(shown('-99999999999')).toEqual(['-001199-02-15 14:13:21', '-001199-02-15T14:13:21.000Z']);
    expect(shown('-62198755200')).toEqual(['-000001-01-01 00:00:00', '-000001-01-01T00:00:00.000Z']);
    expect(shown('-62135596801')).toEqual(['0000-12-31 23:59:59', '0000-12-31T23:59:59.000Z']);
    expect(shown('-62135596800')).toEqual(['0001-01-01 00:00:00', '0001-01-01T00:00:00.000Z']);
    expect(formatInZone(new Date(Date.UTC(1000, 0, 2, 12)), 'UTC')).toBe('1000-01-02 12:00:00');
    expect(formatInZone(new Date(Date.UTC(1000, 0, 4)), 'UTC')).toBe('1000-01-04 00:00:00');
  });

  it('負のエポック時間を符号ごと変換する', () => {
    expect(convertEpochsInText('t=-1700000000 ms=-1700000000123', 'UTC', 'replace')).toEqual({
      output: 't=1916-02-18 01:46:40 +00:00 ms=1916-02-18 01:46:39.877 +00:00',
      count: 2,
    });
    expect(convertEpochsInText('-1700000000.123', 'UTC', 'append')).toEqual({
      output: '-1700000000.123 [1916-02-18 01:46:39.877 +00:00]', count: 1,
    });
    const ids = 'x-1700000000 -1700000000x -12345678901';
    expect(convertEpochsInText(ids, 'UTC', 'replace')).toEqual({ output: ids, count: 0 });
  });

  const log = 't=1700000000 id=12345678901 x1700000000 ms=1700000000123';
  it('10・13・16・19桁の数値だけを日時に変える（前後が英数字のものは対象外）', () => {
    expect(convertEpochsInText(log, 'Asia/Tokyo', 'append')).toEqual({
      output: 't=1700000000 [2023-11-15 07:13:20 +09:00] id=12345678901 x1700000000 ms=1700000000123 [2023-11-15 07:13:20.123 +09:00]',
      count: 2,
    });
  });

  it('置き換えもできる', () => {
    expect(convertEpochsInText('a 1700000000\nb 1700000000123456', 'UTC', 'replace')).toEqual({
      output: 'a 2023-11-14 22:13:20 +00:00\nb 2023-11-14 22:13:20.123 +00:00',
      count: 2,
    });
  });
});

describe('夏時間・地方平均時とログ内の数値境界', () => {
  it('期間が時間・分・秒だけなら、夏時間が終わる日の2回目の時刻からでも経過時間で足す', () => {
    /** 2026-11-01 01:30 は2回あり、これは2回目（EST、-05:00） */
    const second = new Date('2026-11-01T01:30:00-05:00');
    expect(addDuration(second, parseDuration('1h'), 'America/New_York').date.toISOString()).toBe('2026-11-01T07:30:00.000Z');
    expect(addDuration(second, parseDuration('0s'), 'America/New_York').date.toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('秒を含む昔の時差（地方平均時）でも、存在する日時を変換できる', () => {
    /** 1888年より前の東京は +09:18:59 */
    expect(parseDateTime('1800-01-01 00:00:00', 'Asia/Tokyo').toISOString()).toBe('1799-12-31T14:41:01.000Z');
  });

  it('小数の後ろに英数字が続く識別子は、整数部分だけを変換しない', () => {
    expect(convertEpochsInText('id=1700000000.123abc v=3.1700000000', 'UTC', 'replace')).toEqual({
      output: 'id=1700000000.123abc v=3.1700000000',
      count: 0,
    });
    /** 文の終わりの「.」は数値の一部ではない */
    expect(convertEpochsInText('at 1700000000.', 'UTC', 'replace').output).toBe('at 2023-11-14 22:13:20 +00:00.');
  });
});
