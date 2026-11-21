import { describe, expect, it } from 'vitest';
import { parseDerExact } from '../../lib/crypto/asn1';
import { tlv } from '../../lib/crypto/der.testing';
import { readExtensions } from './extensions';

it('未知の拡張の生バイトを表示用の抜粋と別に保持する', () => {
  const bytes = Array.from({ length: 40 }, (_, i) => i);
  const payload = [6, 2, 42, 3, 4, bytes.length, ...bytes];
  const der = new Uint8Array([48, payload.length + 2, 48, payload.length, ...payload]);
  const ext = readExtensions(parseDerExact(der)).extensions[0]!;
  expect(ext.raw).toEqual(new Uint8Array(bytes));
  expect(ext.values[0]).toContain('…');
  expect(ext.raw.buffer).toBe(der.buffer);
});

it('基本制約の大きな整数を丸めずに表示する', () => {
  for (const value of [0n, 9007199254740991n, 9007199254740993n, 9223372036854775807n]) {
    const digits = value.toString(16);
    const hex = digits.padStart(Math.ceil(digits.length / 2) * 2, '0');
    const integer = Uint8Array.from(hex.match(/../g)!.map((byte) => parseInt(byte, 16)));
    const result = readExtensions(parseDerExact(tlv(48, tlv(48,
      tlv(6, Uint8Array.of(85, 29, 19)), tlv(4, tlv(48, tlv(1, Uint8Array.of(255)), tlv(2, integer))),
    ))));
    expect(result.extensions[0]?.values).toEqual(['CA：はい', `下位の CA の段数の上限：${value}`]);
  }
});

describe('不正な拡張値', () => {
  const read = (id: number, value: number[]) => readExtensions(parseDerExact(tlv(48,
    tlv(48, tlv(6, Uint8Array.of(85, 29, id)), tlv(4, Uint8Array.from(value))),
  )));
  it('空のBOOLEANをCAとして表示しない', () => {
    const result = read(19, [48, 2, 1, 0]);
    expect(result.ca).toBeNull();
    expect(result.extensions[0]?.values[0]).toContain('読めない値');
    expect(read(19, [48, 3, 1, 1, 255]).ca).toBe(true);
  });
  it('未使用ビットを鍵の用途として表示しない', () => {
    const result = read(15, [3, 2, 7, 255]);
    expect(result.keyUsage).toEqual([]);
    expect(result.extensions[0]?.values[0]).toContain('読めない値');
    expect(read(15, [3, 2, 7, 128]).keyUsage).toEqual(['デジタル署名（digitalSignature）']);
  });
});
