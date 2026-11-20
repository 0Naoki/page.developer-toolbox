import { describe, expect, it } from 'vitest';
import { Asn1Error, parseDer, parseDerExact, readOid, readString, readTime } from './asn1';
import { derLength } from './der.testing';

const decode = (tag: number, bytes: number[]) => readString(parseDerExact(new Uint8Array([tag, bytes.length, ...bytes])));

describe('DER の文字列', () => {
  it('不正なUTF-8と欠けた文字を置換・切り捨てしない', () => {
    for (const [tag, bytes] of [[12, [255]], [12, [0xc0, 0x80]], [30, [65]], [28, [0, 0, 65]]] as const) {
      expect(() => decode(tag, [...bytes])).toThrow(Asn1Error);
    }
  });
  it('BMP のサロゲートと範囲外の UniversalString を拒否する', () => {
    for (const bytes of [[0, 0, 0xd8, 0], [0, 0x11, 0, 0]]) expect(() => decode(28, bytes)).toThrow(Asn1Error);
    expect(() => decode(30, [0xd8, 0])).toThrow(Asn1Error);
  });
  it('有効な日本語と補助平面の文字を保つ', () => {
    expect(decode(12, [...new TextEncoder().encode('日本😀')])).toBe('日本😀');
    expect(decode(30, [0x65, 0xe5, 0x67, 0x2c])).toBe('日本');
    expect(decode(28, [0, 1, 0xf6, 0])).toBe('😀');
    expect(decode(12, [0xef, 0xbb, 0xbf, 65])).toBe('\uFEFFA');
  });
});

/** 証明書のテスト（src/tools/cert/logic.test.ts）から移した、OID・時刻・構造の上限の検査 */
describe('asn1', () => {
  it('OID全体と各成分の長さを制限し、巨大なBigIntを作らない', () => {
    const oid = (body: number[]) => parseDer(Uint8Array.from([0x06, 0x81, body.length, ...body]));
    expect(readOid(oid(Array(128).fill(0x01))).split('.')).toHaveLength(129);
    expect(() => readOid(oid(Array(129).fill(0x01)))).toThrow('OID が長すぎます');
    expect(readOid(oid([0x2a, ...Array(31).fill(0x81), 0x01]))).toMatch(/^1\.2\.\d+$/);
    expect(() => readOid(oid([0x2a, ...Array(32).fill(0x81), 0x01]))).toThrow('OID の成分が長すぎます');
    /** 先頭の2成分をまとめた値にも同じ上限を適用する。 */
    expect(() => readOid(oid([...Array(32).fill(0x81), 0x01]))).toThrow('OID の成分が長すぎます');
  });
  it('OID を読む', () => {
    /** 1.2.840.113549.1.1.11（sha256WithRSAEncryption） */
    const der = Uint8Array.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
    expect(readOid(parseDer(der))).toBe('1.2.840.113549.1.1.11');
    /** 2.999.3（先頭の値が80以上） */
    expect(readOid(parseDer(Uint8Array.from([0x06, 0x03, 0x88, 0x37, 0x03])))).toBe('2.999.3');
  });

  it('53ビットを超える値の OID も丸めずに読む（2.25.<UUID>）', () => {
    /** Number で組み立てると「2.25.3.2980073569858662e+38」のように丸められる */
    const big = 329800735698586629295641978511506172918n; /** UUID f81d4fae-7dec-11d0-a765-00a0c91e6bf6（RFC 4122 の例） */
    const arcs: number[] = [];
    for (let v = big; v > 0n; v >>= 7n) arcs.unshift(Number(v & 0x7fn));
    const body = [0x69, ...arcs.map((a, i) => (i < arcs.length - 1 ? a | 0x80 : a))];
    expect(readOid(parseDer(Uint8Array.from([0x06, body.length, ...body])))).toBe(`2.25.${big}`);
    expect(() => readOid(parseDer(Uint8Array.from([0x06, 0x01, 0x81])))).toThrow('途中で切れています');
    /** 先頭は読めても最後の値が切れている場合も、切れた部分を捨てて「1.2」としない */
    expect(() => readOid(parseDer(Uint8Array.from([0x06, 0x02, 0x2a, 0x86])))).toThrow('途中で切れています');
  });

  it('UTCTime の2桁の年は、50以上を1900年代、50未満を2000年代とする', () => {
    const time = (tag: number, s: string) => readTime(parseDer(Uint8Array.from([tag, s.length, ...Array.from(s, (c) => c.charCodeAt(0))])));
    expect(time(0x17, '500101000000Z').toISOString()).toBe('1950-01-01T00:00:00.000Z');
    expect(time(0x17, '491231235959Z').toISOString()).toBe('2049-12-31T23:59:59.000Z');
    expect(time(0x18, '20500101000000Z').toISOString()).toBe('2050-01-01T00:00:00.000Z');
    expect(time(0x17, '2601010900+0900').toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(() => time(0x17, '26010100Z')).toThrow('読めません');
  });

  it('GeneralizedTime の小数秒・小数分を切り捨てずに拒否する', () => {
    const time = (s: string) => readTime(parseDer(Uint8Array.from([0x18, s.length, ...Array.from(s, (c) => c.charCodeAt(0))])));
    for (const s of ['20500101000000.5Z', '20500101000000.0Z', '205001010000.5Z', '20500101090000.5+0900']) {
      expect(() => time(s), s).toThrow('証明書の日時に小数部は使えません');
    }
    expect(time('20500101000000Z').toISOString()).toBe('2050-01-01T00:00:00.000Z');
    expect(time('20500101090000+0900').toISOString()).toBe('2050-01-01T00:00:00.000Z');
  });

  it('長い日時の値は、エラーの文言に抜粋だけを入れる', () => {
    const s = '2'.repeat(60_000);
    const der = Uint8Array.from([0x18, 0x82, s.length >> 8, s.length & 0xff, ...Array.from(s, (c) => c.charCodeAt(0))]);
    let message = '';
    try { readTime(parseDer(der)); } catch (e) { message = (e as Error).message; }
    expect(message).toBe(`日時「${'2'.repeat(255)}…」を読めません`);
  });

  it('存在しない日付・時刻は、翌月や翌日に繰り上げずにエラーにする', () => {
    const time = (tag: number, s: string) => readTime(parseDer(Uint8Array.from([tag, s.length, ...Array.from(s, (c) => c.charCodeAt(0))])));
    /** Date は2月30日を3月2日に繰り上げるため、先に範囲を確かめる必要がある */
    for (const s of ['230230000000Z', '230431000000Z', '231301000000Z', '230100000000Z', '230101240000Z', '230101006000Z', '230101000060Z']) {
      expect(() => time(0x17, s), s).toThrow('存在しない日付・時刻です');
    }
    expect(() => time(0x18, '21000229000000Z')).toThrow('存在しない日付・時刻です');
    /** うるう年の2月29日は受け付ける */
    expect(time(0x18, '20240229000000Z').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(time(0x18, '20000229235959Z').toISOString()).toBe('2000-02-29T23:59:59.000Z');
  });

  it('壊れたデータは範囲外を読まずにエラーにする', () => {
    expect(() => parseDer(Uint8Array.from([0x30, 0x05, 0x02, 0x01]))).toThrow('途中で切れています');
    expect(() => parseDer(Uint8Array.from([0x30, 0x80, 0x00, 0x00]))).toThrow('長さ不定');
    expect(() => parseDerExact(Uint8Array.from([0x05, 0x00, 0x05, 0x00]))).toThrow('余分なデータ');
    expect(() => parseDer(Uint8Array.from([0x30, 0x85, 1, 1, 1, 1, 1]))).toThrow('大きすぎます');
    /** SEQUENCE を100段入れ子にする（長さが128以上の段は 0x81・0x82 で始まる長い形式で書く） */
    let deep = [0x05, 0x00];
    for (let i = 0; i < 100; i++) deep = [0x30, ...derLength(deep.length), ...deep];
    expect(() => parseDer(Uint8Array.from(deep))).toThrow('深すぎます');
  });
});
