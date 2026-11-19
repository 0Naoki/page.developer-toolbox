import { base64ToBytes, bytesToBase64 } from '../../lib/bytes';
import { isContext, parseDerExact, rawOf } from '../../lib/crypto/asn1';
import { tlv } from '../../lib/crypto/der.testing';
import { ED25519 } from './certificates.fixtures';

/** 解析の境界値を検査するため、公開のテスト証明書を組み替える。署名は一致しない。 */
function modifiedCertificate(field: 'subject' | 'extension', tag: number, value: number[]): string {
  const root = parseDerExact(base64ToBytes(ED25519.replace(/-----[^-]+-----/g, '')));
  const tbs = root.children[0]!;
  const replacement = field === 'subject'
    ? tlv(0x30, tlv(0x31, tlv(0x30, new Uint8Array([6, 3, 0x55, 4, 3]), tlv(tag, new Uint8Array(value)))))
    : tlv(0xa3, tlv(0x30, tlv(0x30, new Uint8Array([6, 2, 42, 3]), tlv(4, new Uint8Array(value)))));
  const body = tbs.children.map((node, i) => (field === 'subject' ? i === 5 : isContext(node, 3)) ? replacement : rawOf(node));
  if (field === 'extension' && !tbs.children.some((node) => isContext(node, 3))) body.push(replacement);
  const der = tlv(0x30, tlv(0x30, ...body), ...root.children.slice(1).map(rawOf));
  return `-----BEGIN CERTIFICATE-----\n${bytesToBase64(der)}\n-----END CERTIFICATE-----`;
}

/** 指定した ASN.1 の型とバイト列を主体の CN に使う。 */
export const certificateWithSubject = (tag: number, value: number[]) => modifiedCertificate('subject', tag, value);
/** 未知の拡張 1.2.3 の生バイトを指定する。 */
export const certificateWithRawExtension = (value: number[]) => modifiedCertificate('extension', 4, value);
