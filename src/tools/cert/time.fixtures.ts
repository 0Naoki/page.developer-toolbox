import { base64ToBytes, bytesToBase64 } from '../../lib/bytes';
import { assertTag, parseDerExact, rawOf, TAG } from '../../lib/crypto/asn1';
import { tlv } from '../../lib/crypto/der.testing';
import { ED25519 } from './certificates.fixtures';

/**
 * 既存の証明書の開始日時か終了日時を GeneralizedTime に置き換える。
 * @remarks 署名は作り直さないため一致しない。日時の解析・エラー表示の検査だけに使う。
 */
export function certificateWithTime(field: 'notBefore' | 'notAfter', text: string): string {
  const root = parseDerExact(base64ToBytes(ED25519.replace(/-----[^-]+-----/g, '')));
  const tbs = assertTag(root.children[0], TAG.SEQUENCE, 'テスト証明書の本体');
  /** テスト用の ED25519 はバージョン指定のある v3 証明書。 */
  const validity = assertTag(tbs.children[4], TAG.SEQUENCE, 'テスト証明書の有効期間');
  const replacement = tlv(TAG.GENERALIZED_TIME, new TextEncoder().encode(text));
  const times = validity.children.map((time, i) => i === (field === 'notBefore' ? 0 : 1) ? replacement : rawOf(time));
  const body = tlv(0x30, ...tbs.children.map((item) => item === validity ? tlv(0x30, ...times) : rawOf(item)));
  return `-----BEGIN CERTIFICATE-----\n${bytesToBase64(tlv(0x30, body, ...root.children.slice(1).map(rawOf)))}\n-----END CERTIFICATE-----`;
}
