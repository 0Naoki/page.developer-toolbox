/** 公開鍵（SubjectPublicKeyInfo）の種類の判定（証明書の署名の検証と JWT の公開鍵で共通） */
import { assertTag, isUniversal, parseDer, readOid, TAG } from './asn1';
import { curveInfo, type WebCryptoCurve } from './curves';

export type KeyKind =
  | { kind: 'rsa' }
  | { kind: 'ec'; curve: WebCryptoCurve; size: number }
  /** Web Crypto API が対応していない曲線（secp256k1、曲線のパラメーターを直接書いた鍵など） */
  | { kind: 'ec-unsupported'; curve: string }
  | { kind: 'ed25519' }
  | { kind: 'other' };

/**
 * SubjectPublicKeyInfo の DER から、鍵の種類（と ECDSA の曲線）を求める。
 *
 * @throws 公開鍵の形として読めない場合。
 */
export function keyKindOf(spki: Uint8Array): KeyKind {
  const alg = assertTag(parseDer(spki).children[0], TAG.SEQUENCE, '公開鍵のアルゴリズム');
  const oid = readOid(assertTag(alg.children[0], TAG.OID, '公開鍵のアルゴリズムの OID'));
  if (oid === '1.2.840.113549.1.1.1' || oid === '1.2.840.113549.1.1.10') return { kind: 'rsa' };
  if (oid === '1.3.101.112') return { kind: 'ed25519' };
  if (oid === '1.2.840.10045.2.1') {
    const param = alg.children[1];
    const curveOid = isUniversal(param, TAG.OID) ? readOid(param) : '';
    const curve = curveInfo(curveOid);
    if (curve?.webCrypto) return { kind: 'ec', curve: curve.name, size: Math.ceil(curve.bits / 8) };
    return { kind: 'ec-unsupported', curve: curve?.name ?? (curveOid || '曲線のパラメーターを直接指定した鍵') };
  }
  return { kind: 'other' };
}
