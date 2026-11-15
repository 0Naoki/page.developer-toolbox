import { describe, expect, it } from 'vitest';
import { LEAF, ROOT_CA } from '../../tools/cert/certificates.fixtures';
import { parseCertificate } from '../../tools/cert/logic';
import { readPemBlocks } from './pem';
import { certificatePublicKey } from './x509';

describe('certificatePublicKey', () => {
  it('証明書の解析（証明書デコーダー）と同じ公開鍵と CN を取り出す', () => {
    for (const pem of [LEAF, ROOT_CA]) {
      const der = readPemBlocks(pem, { checkType: () => {}, maxBlocks: 1, tooMany: '' })[0]!.der;
      const cert = parseCertificate(der);
      const key = certificatePublicKey(der);
      expect(Array.from(key.spki)).toEqual(Array.from(cert.signed.spki));
      expect(key.commonName).toBe(cert.subject.attrs.find((a) => a.short === 'CN')?.value ?? null);
    }
  });

  it('証明書の形でなければエラーにする', () => {
    expect(() => certificatePublicKey(Uint8Array.from([0x30, 0x00]))).toThrow('証明書の形ではありません');
    expect(() => certificatePublicKey(Uint8Array.from([0x02, 0x01, 0x01]))).toThrow('証明書の形ではありません');
    expect(() => certificatePublicKey(Uint8Array.from([0x30]))).toThrow();
  });
});
