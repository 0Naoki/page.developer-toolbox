/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - UUID v7・ULID の生成順：画面の生成器の組を使い続け、生成をまたいでも、同じ時刻・時計の戻り・後の乱数が小さい場合に生成順に並ぶこと
 */
import { describe, expect, it } from 'vitest';
import { createSortableIdGenerators, createUlidGenerator, createUuidV7Generator, encodeUlidTime, inspectId, uuidV4, type Rng } from './logic';

const zeroRng: Rng = (b) => b.fill(0);
const maxRng: Rng = (b) => b.fill(255);

describe('UUID', () => {
  it('v4 の形式とバージョン', () => {
    for (let i = 0; i < 100; i++) {
      expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuidV4())).toBe(true);
    }
    expect(uuidV4(maxRng)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('v7 は時刻を先頭に埋め込む', () => {
    const t = Date.parse('2026-10-26T00:00:00Z');
    const id = createUuidV7Generator(zeroRng)(t);
    expect(id).toBe('01a17581-c000-7000-8000-000000000000');
    const info = inspectId(id);
    expect(info.kind === 'uuid' && info.version === 7 && info.time === t).toBe(true);
  });

  it('v7 は時刻順に並ぶ', () => {
    const gen = createUuidV7Generator();
    const ids = [1, 2, 3].map((n) => gen(1_700_000_000_000 + n));
    expect([...ids].sort().join()).toBe(ids.join());
  });

  it('v7 は同じミリ秒内でも生成順に並ぶ', () => {
    const gen = createUuidV7Generator();
    const t = Date.now();
    const ids = Array.from({ length: 1000 }, () => gen(t));
    expect([...ids].sort().join()).toBe(ids.join());
    expect(new Set(ids).size).toBe(1000);
    /** 時計が戻っても順序を保つ */
    const back = gen(t - 5000);
    expect(back > ids[999]!).toBe(true);
    for (const id of ids.slice(0, 3)) {
      const info = inspectId(id);
      expect(info.kind === 'uuid' && info.version === 7 && info.variant === 'RFC 9562' && info.time === t).toBe(true);
    }
  });

  it('v7 の乱数部が桁あふれしたら時刻を進める', () => {
    const gen = createUuidV7Generator(maxRng);
    const a = gen(1000);
    const b = gen(1000);
    expect(a < b).toBe(true);
    const info = inspectId(b);
    expect(info.kind === 'uuid' && info.time).toBe(1001);
  });

  it('v1 の時刻を取り出せる', () => {
    /** 1998-02-04T22:13:53.151Z に生成された RFC 4122 の例 */
    const info = inspectId('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    expect(info.kind === 'uuid' && info.version).toBe(1);
    expect(info.kind === 'uuid' && new Date(info.time!).toISOString()).toBe('1998-02-04T22:13:53.151Z');
  });
});

describe('ULID', () => {
  it('仕様の例と同じ時刻部になる', () => {
    expect(encodeUlidTime(1469918176385)).toBe('01ARYZ6S41');
  });

  it('26文字で、乱数部は Crockford Base32', () => {
    expect(createUlidGenerator(zeroRng)(0)).toBe('0'.repeat(26));
    expect(createUlidGenerator(maxRng)(0)).toBe('0000000000' + 'Z'.repeat(16));
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(createUlidGenerator()())).toBe(true);
  });

  it('同じミリ秒内でも単調増加する', () => {
    const gen = createUlidGenerator(zeroRng);
    const a = gen(1000);
    const b = gen(1000);
    const c = gen(999); /** 時計が戻っても順序を保つ */
    expect(a < b && b < c).toBe(true);
    expect(b.slice(-1)).toBe('1');
  });

  it('時刻を取り出せる', () => {
    const info = inspectId('01ARYZ6S41TSV4RRFFQ69G5FAV');
    expect(info.kind === 'ulid' && info.time).toBe(1469918176385);
  });
});

describe('inspectId', () => {
  it('RFC 9562 の v6 のテスト値から時刻を取り出す', () => {
    expect(inspectId('1EC9414C-232A-6B00-B3C8-9F6BDECED846')).toMatchObject({
      kind: 'uuid', version: 6, timeStatus: 'decoded', time: 1645557742000,
    });
  });

  it('時刻なしと解析未対応を区別し、RFC 以外のバリアントから時刻を推測しない', () => {
    expect(inspectId('550e8400-e29b-41d4-a716-446655440000')).toMatchObject({ timeStatus: 'absent' });
    expect(inspectId('550e8400-e29b-81d4-a716-446655440000')).toMatchObject({ timeStatus: 'unsupported' });
    expect(inspectId('550e8400-e29b-71d4-c716-446655440000')).toMatchObject({ timeStatus: 'unsupported' });
  });

  it('括弧とハイフンが不完全な UUID は補正せずに拒否する', () => {
    for (const value of [
      '{550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440000}',
      '550e8400e29b-41d4-a716-446655440000',
      '550e8400-e29b41d4a716446655440000',
    ]) expect(() => inspectId(value), value).toThrow();
    for (const value of ['550e8400-e29b-41d4-a716-446655440000', '550e8400e29b41d4a716446655440000', '{550e8400-e29b-41d4-a716-446655440000}']) {
      expect(inspectId(value).canonical).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('ハイフンなし・波括弧付きのUUIDも受け付ける', () => {
    const info = inspectId('{6BA7B8109DAD11D180B400C04FD430C8}');
    expect(info.canonical).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });

  it('不正な値はエラー', () => {
    expect(() => inspectId('hello')).toThrow();
  });
});

describe('画面の生成器の組', () => {
  it('同じ組を使えば、生成をまたいでも、同じ時刻・時計の戻り・後の乱数が小さい場合も生成順に並ぶ', () => {
    /** 1回目は大きい乱数、2回目以降は小さい乱数を返す */
    let call = 0;
    const rng: Rng = (bytes) => { bytes.fill(call++ === 0 ? 0xf0 : 0x01); return bytes; };
    for (const kind of ['v7', 'ulid'] as const) {
      call = 0;
      const generators = createSortableIdGenerators(rng);
      const batch = (now: number) => Array.from({ length: 3 }, () => generators[kind](now));
      const ids = [...batch(1000), ...batch(1000), ...batch(999)];
      expect(ids, kind).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
