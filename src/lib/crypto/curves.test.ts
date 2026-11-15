/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 曲線OID × 表示と署名検証：P-256・P-384・P-521のビット数と成分長（32・48・66バイト）を保つ。secp256k1は表示できても検証対象にせず、未知のOIDを残す（あわせて `src/tools/cert/verify.test.ts`・`src/tools/jwt-decoder/verify.test.ts`）
 */
import { describe, expect, it } from 'vitest';
import { curveInfo } from './curves';
import { keyKindOf } from './spki';

/** 曲線OIDを持つSPKIの外形。曲線の判定だけを検査するため、公開点は空にする。 */
function spki(curveOid: number[]) {
  const algorithm = [6, 7, 0x2a, 0x86, 0x48, 0xce, 0x3d, 2, 1, 6, curveOid.length, ...curveOid];
  return Uint8Array.from([0x30, algorithm.length + 5, 0x30, algorithm.length, ...algorithm, 3, 1, 0]);
}

describe('曲線情報と公開鍵の判定', () => {
  for (const [oid, encoded, name, bits, size] of [
    ['1.2.840.10045.3.1.7', [0x2a, 0x86, 0x48, 0xce, 0x3d, 3, 1, 7], 'P-256', 256, 32],
    ['1.3.132.0.34', [0x2b, 0x81, 4, 0, 0x22], 'P-384', 384, 48],
    ['1.3.132.0.35', [0x2b, 0x81, 4, 0, 0x23], 'P-521', 521, 66],
  ] as const) {
    it(`${name} の表示用ビット数と署名の成分長を保つ`, () => {
      expect(curveInfo(oid)).toMatchObject({ name, bits, webCrypto: true });
      expect(keyKindOf(spki([...encoded]))).toEqual({ kind: 'ec', curve: name, size });
    });
  }

  it('secp256k1 の名前とビット数を表示できても、検証には使わない', () => {
    expect(curveInfo('1.3.132.0.10')).toMatchObject({ name: 'secp256k1', bits: 256, webCrypto: false });
    expect(keyKindOf(spki([0x2b, 0x81, 4, 0, 0x0a]))).toEqual({ kind: 'ec-unsupported', curve: 'secp256k1' });
  });

  it('未知の曲線はOIDを残し、対応表にない値を既知の曲線として扱わない', () => {
    expect(keyKindOf(spki([0x2a, 3, 4]))).toEqual({ kind: 'ec-unsupported', curve: '1.2.3.4' });
    for (const oid of ['1.2.3.4', 'toString', '__proto__']) expect(curveInfo(oid)).toBeUndefined();
  });
});
