import { describe, expect, it } from 'vitest';
import { JST_ZONE } from './timezone';
import { formatInZone, formatJst, formatJstLabeled, formatOffset, formatWithOffset, hasWrittenFraction, jstZoneLabel, relativeFrom, showsMillis } from './dateTimeFormat';
import { parseDateTime } from './dateTimeInput';

/** 日時の表示（dateTimeFormat.ts）のテスト。表示を解析で読み戻せること（往復）は dateTimeInput.test.ts で確かめる */

describe('relativeFrom', () => {
  it('相対表記を返す', () => {
    expect(relativeFrom(new Date(0), 90_000)).toBe('1分前');
    expect(relativeFrom(new Date(2 * 86400_000), 0)).toBe('2日後');
  });
});

describe('ずれの表示', () => {
  it('ずれを「+09:00」の形にする', () => {
    expect(formatOffset(540)).toBe('+09:00');
    expect(formatOffset(-300)).toBe('-05:00');
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(0)).toBe('+00:00');
  });

  it('ずれ付きで表示する', () => {
    expect(formatWithOffset(new Date('2024-01-01T00:00:00.5Z'), 'Asia/Tokyo', true)).toBe('2024-01-01 09:00:00.500 +09:00');
    expect(formatWithOffset(new Date('2024-07-01T00:00:00Z'), 'America/New_York')).toBe('2024-06-30 20:00:00 -04:00');
  });

  it('範囲の端の時刻で、正と負のオフセットを付けて表示する', () => {
    expect(formatWithOffset(new Date('+275760-09-13T00:00:00.000Z'), 'Asia/Tokyo')).toBe('+275760-09-13 09:00:00 +09:00');
    expect(formatWithOffset(new Date('-271821-04-20T00:00:00.000Z'), 'America/New_York')).toBe('-271821-04-19 19:03:58 -04:56:02');
  });
});

describe('表示の年の書式', () => {
  it('紀元前と10000年以降は、ISO8601 の拡張年で表示する', () => {
    expect(formatInZone(new Date('+010000-01-01T00:00:00.000Z'), 'UTC')).toBe('+010000-01-01 00:00:00');
    expect(formatInZone(new Date(Date.UTC(9999, 11, 31, 23)), 'Asia/Tokyo')).toBe('+010000-01-01 08:00:00');
    expect(formatInZone(new Date(Date.UTC(9999, 11, 31, 12)), 'UTC')).toBe('9999-12-31 12:00:00');
  });
});

describe('表示の精度', () => {
  it('端数がある時刻は必ずミリ秒を含め、端数がなければ入力の精度に合わせる', () => {
    expect(showsMillis(new Date(1700000000123))).toBe(true);
    expect(showsMillis(new Date(-1))).toBe(true);
    expect(showsMillis(new Date(1700000000000))).toBe(false);
    expect(showsMillis(new Date(1700000000000), true)).toBe(true);
    expect(hasWrittenFraction('2024-01-01 09:00:00.000 +09:00')).toBe(true);
    expect(hasWrittenFraction('2024-01-01T00:00:00Z')).toBe(false);
  });
});

describe('formatInZone', () => {
  it('表示の書式を切り替える境目（1000年の始め）の前後も、年を4桁で表示する', () => {
    /** unix-time のテストから移した。境目（1000-01-03）より前は自前の書式、後は Intl の書式で、どちらも同じ形になる */
    expect(formatInZone(new Date(Date.UTC(1000, 0, 2, 12)), 'UTC')).toBe('1000-01-02 12:00:00');
    expect(formatInZone(new Date(Date.UTC(1000, 0, 4)), 'UTC')).toBe('1000-01-04 00:00:00');
  });
});

describe('日本時間の表示', () => {
  it('JST_ZONE で表示し、ラベル付きのときだけ末尾に JST を付ける', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    expect(formatJst(date)).toBe(formatInZone(date, JST_ZONE));
    expect(formatJst(date)).toBe('2026-01-01 09:00:00');
    expect(formatJstLabeled(date)).toBe('2026-01-01 09:00:00 JST');
  });

  it('withMillis のときはミリ秒も付ける（UUID v7 の生成日時など）', () => {
    expect(formatJstLabeled(new Date('2026-01-01T00:00:00.120Z'), true)).toBe('2026-01-01 09:00:00.120 JST');
    expect(formatJstLabeled(new Date('1969-12-31T23:59:59.999Z'), true)).toBe('1970-01-01 08:59:59.999 JST');
  });

  it('回帰：1888年より前の日時は「JST」ではなくオフセットを付け、日時入力に貼り戻すと同じ時刻になる', () => {
    /** 1888年より前の東京は地方平均時（+09:18:59）。「JST」と付けると、日時入力が +09:00 として読み、18分59秒ずれていた */
    const uuidV1Origin = new Date('1582-10-15T00:00:00Z');
    expect(formatJstLabeled(uuidV1Origin)).toBe('1582-10-15 09:18:59 +09:18:59');
    expect(jstZoneLabel(uuidV1Origin)).toBe('+09:18:59');
    for (const iso of ['1582-10-15T00:00:00Z', '1887-12-31T14:59:59.500Z', '1887-12-31T15:00:00Z', '2026-01-01T00:00:00Z']) {
      const date = new Date(iso);
      const shown = formatJstLabeled(date, showsMillis(date));
      expect(parseDateTime(shown, JST_ZONE).getTime(), shown).toBe(date.getTime());
    }
    expect(formatJstLabeled(new Date('1887-12-31T15:00:00Z'))).toBe('1888-01-01 00:00:00 JST');
  });
});
