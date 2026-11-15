/** JWT（JWS）の署名アルゴリズム（RFC 7518）と、Web Crypto API の指定との対応 */

import { detailPreview } from '../../lib/text/textPreview';
import type { WebCryptoCurve } from '../../lib/crypto/curves';
import type { WebCryptoHash } from '../../lib/crypto/signature';

/** JWS（RFC 7518）のアルゴリズムで使うハッシュ。SHA-1 は含まれない */
type HashName = Exclude<WebCryptoHash, 'SHA-1'>;

export type AlgSpec =
  | { family: 'hmac'; hash: HashName; bytes: number }
  | { family: 'rsa'; hash: HashName }
  | { family: 'pss'; hash: HashName; saltLength: number }
  | { family: 'ecdsa'; hash: HashName; curve: WebCryptoCurve; size: number }
  | { family: 'eddsa' };

/** 検証に対応していない（alg がない・none・ブラウザで扱えない）ことを表す例外 */
class Unsupported extends Error {}

const CURVE_OF: Record<string, { curve: WebCryptoCurve; size: number }> = {
  '256': { curve: 'P-256', size: 32 },
  '384': { curve: 'P-384', size: 48 },
  '512': { curve: 'P-521', size: 66 },
};

/** alg（RFC 7518）を Web Crypto API の指定に直す。対応していなければ Unsupported を投げる */
export function algSpec(alg: unknown): AlgSpec {
  if (typeof alg !== 'string') throw new Unsupported('ヘッダに alg（署名アルゴリズム）がありません');
  if (alg.toLowerCase() === 'none') throw new Unsupported('alg が none（署名なし）のため、検証するものがありません');
  const m = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg);
  if (m) {
    const curve = CURVE_OF[m[2] ?? ''];
    if (curve === undefined) throw new Unsupported('署名アルゴリズムのビット数を読めません');
    const hash = `SHA-${m[2]}` as HashName;
    const bytes = Number(m[2]) / 8;
    if (m[1] === 'HS') return { family: 'hmac', hash, bytes };
    if (m[1] === 'RS') return { family: 'rsa', hash };
    /** RFC 7518 3.5：ソルト長はハッシュの長さと同じ */
    if (m[1] === 'PS') return { family: 'pss', hash, saltLength: bytes };
    return { family: 'ecdsa', hash, ...curve };
  }
  if (alg === 'EdDSA' || alg === 'Ed25519') return { family: 'eddsa' };
  if (alg === 'ES256K') throw new Unsupported('ES256K（secp256k1）の署名は、ブラウザ（Web Crypto API）で検証できません');
  if (alg === 'Ed448') throw new Unsupported('Ed448 の署名は、ブラウザ（Web Crypto API）で検証できません');
  throw new Unsupported(`この署名アルゴリズム（${detailPreview(alg)}）には対応していません`);
}

/** 秘密鍵（共通鍵）で検証する alg（HS256 など）か */
export const isHmacAlg = (alg: unknown): boolean => typeof alg === 'string' && /^HS(256|384|512)$/.test(alg);


/** 鍵の種類（RSA・曲線の名前など） */
export type KeyType = 'RSA' | 'P-256' | 'P-384' | 'P-521' | 'Ed25519' | string;

/** alg に必要な鍵の種類 */
export const neededKey = (spec: Exclude<AlgSpec, { family: 'hmac' }>): KeyType =>
  spec.family === 'ecdsa' ? spec.curve : spec.family === 'eddsa' ? 'Ed25519' : 'RSA';
