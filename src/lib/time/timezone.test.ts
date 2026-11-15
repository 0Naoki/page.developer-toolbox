import { describe, expect, it } from 'vitest';
import { canonicalZone, isValidZone, offsetMinutes } from './timezone';

/** タイムゾーンの変換と範囲の検査（timezone.ts）のテスト。解析は dateTimeInput.test.ts、表示は dateTimeFormat.test.ts */

describe('タイムゾーン', () => {
  it('UTC からのずれ（夏時間を含む）', () => {
    expect(offsetMinutes(Date.UTC(2024, 0, 1), 'Asia/Tokyo')).toBe(540);
    expect(offsetMinutes(Date.UTC(2024, 0, 1), 'America/New_York')).toBe(-300);
    expect(offsetMinutes(Date.UTC(2024, 6, 1), 'America/New_York')).toBe(-240);
    expect(offsetMinutes(Date.UTC(2024, 0, 1), 'Asia/Kolkata')).toBe(330);
  });

  it('範囲の端の時刻で、正と負のオフセットを計算する', () => {
    expect(offsetMinutes(8.64e15, 'Asia/Tokyo')).toBe(540);
    expect(offsetMinutes(-8.64e15, 'America/New_York')).toBe(-296);
  });

  it('存在するタイムゾーン名かを確かめる', () => {
    expect(isValidZone('Asia/Tokyo')).toBe(true);
    expect(isValidZone('UTC')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
    expect(isValidZone('')).toBe(false);
  });
});

describe('canonicalZone', () => {
  it('大文字小文字の違うタイムゾーン名を、正式な表記にそろえる', () => {
    expect(canonicalZone('asia/tokyo')).toBe('Asia/Tokyo');
    expect(canonicalZone(' America/New_York ')).toBe('America/New_York');
    expect(canonicalZone('Mars/Olympus')).toBeNull();
    expect(canonicalZone('')).toBeNull();
  });
});
