import { describe, expect, it } from 'vitest';
import { Asn1Error, parseDerExact, readString } from './asn1';

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
