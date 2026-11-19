/**
 * テストで DER（ASN.1）を組み立てる補助。長さの書き方（短い形式と、0x81〜0x83 で始まる長い形式）を1か所にそろえる。
 * テストとテスト用のデータ（*.fixtures.ts）からだけ読む。
 */

/** 中身の長さ（バイト数）の書き方。127 以下は1バイト、それより長いと 0x81〜0x83 に続けて長さを書く */
export function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  if (n < 0x10000) return [0x82, n >> 8, n & 0xff];
  return [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
}

/** タグと中身（バイト列を連結したもの）から、1つの要素を作る */
export function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const head = [tag, ...derLength(size)];
  const result = new Uint8Array(head.length + size);
  result.set(head);
  let offset = head.length;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** 中身を数の配列で書くテスト向けの tlv（結果も数の配列） */
export const tlvNumbers = (tag: number, body: number[]): number[] => [tag, ...derLength(body.length), ...body];
