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
  it.each<[string, number[]]>([
    ['末尾の余剰データ', [48, 3, 1, 1, 255, 0]],
    ['SEQUENCEではなくSET', [49, 3, 1, 1, 255]],
    ['primitiveのSEQUENCE', [16, 3, 1, 1, 255]],
    ['CAの重複', [48, 6, 1, 1, 255, 1, 1, 255]],
    ['未知の項目', [48, 5, 1, 1, 255, 5, 0]],
    ['負の段数', [48, 6, 1, 1, 255, 2, 1, 255]],
    ['空の段数', [48, 5, 1, 1, 255, 2, 0]],
    ['不要な先頭の00を含む段数', [48, 7, 1, 1, 255, 2, 2, 0, 1]],
    ['CAでない段数指定', [48, 3, 2, 1, 1]],
    ['長さの上限を超えた段数', [48, 14, 1, 1, 255, 2, 9, 1, 0, 0, 0, 0, 0, 0, 0, 0]],
  ])('基本制約の%sを拒否し、途中のCA判定を残さない', (_name, bytes) => {
    const result = read(19, bytes);
    expect(result.ca).toBeNull();
    expect(result.extensions[0]?.values[0]).toContain('読めない値');
    expect(result.extensions[0]?.raw).toEqual(Uint8Array.from(bytes));
  });

  it('空の基本制約とCA・段数の省略を受け付ける', () => {
    expect(read(19, [48, 0]).ca).toBe(false);
    expect(read(19, [48, 3, 1, 1, 255]).ca).toBe(true);
    expect(read(19, [48, 6, 1, 1, 255, 2, 1, 0]).extensions[0]?.values).toEqual(['CA：はい', '下位の CA の段数の上限：0']);
    /** 128 は、正の数のまま表すために先頭の 00 が必要 */
    expect(read(19, [48, 7, 1, 1, 255, 2, 2, 0, 128]).extensions[0]?.values).toEqual(['CA：はい', '下位の CA の段数の上限：128']);
  });

  it('不正な基本制約の後も、別の拡張を読み取れる', () => {
    const result = readExtensions(parseDerExact(tlv(48,
      tlv(48, tlv(6, Uint8Array.of(85, 29, 19)), tlv(4, Uint8Array.of(48, 14, 1, 1, 255, 2, 9, 1, 0, 0, 0, 0, 0, 0, 0, 0))),
      tlv(48, tlv(6, Uint8Array.of(85, 29, 17)), tlv(4, Uint8Array.of(48, 3, 130, 1, 97))),
    )));
    expect(result.ca).toBeNull();
    expect(result.san).toEqual([{ type: 'DNS', value: 'a' }]);
  });

  it.each([
    [17, [48, 3, 130, 1, 97]],
    [15, [3, 2, 7, 128]],
    [37, [48, 4, 6, 2, 42, 3]],
    [14, [4, 1, 1]],
    [35, [48, 3, 128, 1, 1]],
    [31, [48, 0]],
    [32, [48, 6, 48, 4, 6, 2, 42, 3]],
  ])('拡張2.5.29.%iの型と末尾を検査する', (id, bytes) => {
    expect(read(id, bytes).extensions[0]?.values.join('')).not.toContain('読めない値');
    for (const invalid of [[...bytes, 0], [bytes[0]! ^ 1, ...bytes.slice(1)]]) {
      expect(read(id, invalid).extensions[0]?.values[0]).toContain('読めない値');
    }
  });

  it('AIAの型と末尾を検査する', () => {
    const value = tlv(48, tlv(48, tlv(6, Uint8Array.of(43, 6, 1, 5, 5, 7, 48, 1)), tlv(134, Uint8Array.of(97))));
    const readAia = (bytes: Uint8Array) => readExtensions(parseDerExact(tlv(48,
      tlv(48, tlv(6, Uint8Array.of(43, 6, 1, 5, 5, 7, 1, 1)), tlv(4, bytes)),
    ))).extensions[0]!.values;
    expect(readAia(value)).toEqual(['OCSP: a']);
    expect(readAia(Uint8Array.of(...value, 0))[0]).toContain('読めない値');
    const wrongTag = value.slice();
    wrongTag[0] = 49;
    expect(readAia(wrongTag)[0]).toContain('読めない値');
  });
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
