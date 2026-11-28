/** JWT（JWS）の署名アルゴリズム（RFC 7518）と、Web Crypto API の指定との対応 */

import { detailPreview } from '../../lib/text/textPreview';
import type { WebCryptoCurve } from '../../lib/crypto/curves';
import type { WebCryptoHash } from '../../lib/crypto/signature';

/** JWS（RFC 7518）のアルゴリズムで使うハッシュ。SHA-1 は含まれない */
type HashName = Exclude<WebCryptoHash, 'SHA-1'>;

export type AlgSpec =
  | { family: 'hmac'; hash: HashName }
  | { family: 'rsa'; hash: HashName }
  | { family: 'pss'; hash: HashName; saltLength: number }
  | { family: 'ecdsa'; hash: HashName; curve: WebCryptoCurve; size: number }
  | { family: 'eddsa' };

const CURVE_OF: Record<string, { curve: WebCryptoCurve; size: number }> = {
  '256': { curve: 'P-256', size: 32 },
  '384': { curve: 'P-384', size: 48 },
  '512': { curve: 'P-521', size: 66 },
};

/**
 * alg（RFC 7518）を Web Crypto API の指定に直す。
 *
 * @throws 検証に対応していないとき（alg がない・none・ブラウザで扱えない）。呼び出し側は「検証できない」として文言を表示する
 */
export function algSpec(alg: unknown): AlgSpec {
  if (typeof alg !== 'string') throw new Error('ヘッダに alg（署名アルゴリズム）がありません');
  if (alg.toLowerCase() === 'none') throw new Error('alg が none（署名なし）のため、検証するものがありません');
  const m = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg);
  if (m) {
    const curve = CURVE_OF[m[2] ?? ''];
    if (curve === undefined) throw new Error('署名アルゴリズムのビット数を読めません');
    const hash = `SHA-${m[2]}` as HashName;
    const bytes = Number(m[2]) / 8;
    if (m[1] === 'HS') return { family: 'hmac', hash };
    if (m[1] === 'RS') return { family: 'rsa', hash };
    /** RFC 7518 3.5：ソルト長はハッシュの長さと同じ */
    if (m[1] === 'PS') return { family: 'pss', hash, saltLength: bytes };
    return { family: 'ecdsa', hash, ...curve };
  }
  if (alg === 'EdDSA' || alg === 'Ed25519') return { family: 'eddsa' };
  if (alg === 'ES256K') throw new Error('ES256K（secp256k1）の署名は、ブラウザ（Web Crypto API）で検証できません');
  if (alg === 'Ed448') throw new Error('Ed448 の署名は、ブラウザ（Web Crypto API）で検証できません');
  throw new Error(`この署名アルゴリズム（${detailPreview(alg)}）には対応していません`);
}

/** 秘密鍵（共通鍵）で検証する alg（HS256 など）か */
export const isHmacAlg = (alg: unknown): boolean => typeof alg === 'string' && /^HS(256|384|512)$/.test(alg);

/** 鍵の種類（`RSA`・`P-256` などの曲線の名前・`Ed25519`）。検証できない曲線（`secp256k1` など）の名前も入る */
export type KeyType = string;

/** alg に必要な鍵の種類 */
export const neededKey = (spec: Exclude<AlgSpec, { family: 'hmac' }>): KeyType =>
  spec.family === 'ecdsa' ? spec.curve : spec.family === 'eddsa' ? 'Ed25519' : 'RSA';
