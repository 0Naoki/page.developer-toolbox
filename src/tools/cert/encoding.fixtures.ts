import { base64ToBytes, bytesToBase64 } from '../../lib/bytes';
import { isContext, parseDerExact, rawOf } from '../../lib/crypto/asn1';
import { tlv } from '../../lib/crypto/der.testing';
import { ED25519 } from './certificates.fixtures';

/** 解析の境界値を検査するため、公開のテスト証明書を組み替える。署名は一致しない。 */
function modifiedCertificate(field: 'subject' | 'extension', tag: number, value: number[], extensionOid = Uint8Array.of(42, 3)): string {
  const root = parseDerExact(base64ToBytes(ED25519.replace(/-----[^-]+-----/g, '')));
  const tbs = root.children[0]!;
  const replacement = field === 'subject'
    ? tlv(0x30, tlv(0x31, tlv(0x30, new Uint8Array([6, 3, 0x55, 4, 3]), tlv(tag, new Uint8Array(value)))))
    : tlv(0xa3, tlv(0x30, tlv(0x30, tlv(6, extensionOid), tlv(4, new Uint8Array(value)))));
  const body = tbs.children.map((node, i) => (field === 'subject' ? i === 5 : isContext(node, 3)) ? replacement : rawOf(node));
  if (field === 'extension' && !tbs.children.some((node) => isContext(node, 3))) body.push(replacement);
  const der = tlv(0x30, tlv(0x30, ...body), ...root.children.slice(1).map(rawOf));
  return `-----BEGIN CERTIFICATE-----\n${bytesToBase64(der)}\n-----END CERTIFICATE-----`;
}

/** 指定した ASN.1 の型とバイト列を主体の CN に使う。 */
export const certificateWithSubject = (tag: number, value: number[]) => modifiedCertificate('subject', tag, value);
/** 未知の拡張 1.2.3 の生バイトを指定する。 */
export const certificateWithRawExtension = (value: number[]) => modifiedCertificate('extension', 4, value);

/** 基本制約の段数を指定する。大きな整数の表示を検査するため、Numberを経由せずDERにする。 */
export function certificateWithPathLength(value: bigint): string {
  const digits = value.toString(16);
  const hex = digits.padStart(Math.ceil(digits.length / 2) * 2, '0');
  const bytes = hex.match(/../g)!.map((byte) => parseInt(byte, 16));
  if (bytes[0]! >= 128) bytes.unshift(0);
  const body = tlv(48, tlv(1, Uint8Array.of(255)), tlv(2, Uint8Array.from(bytes)));
  return modifiedCertificate('extension', 4, [...body], Uint8Array.of(85, 29, 19));
}
