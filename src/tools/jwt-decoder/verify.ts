/**
 * JWT（JWS）の署名の検証（Web Crypto API）。
 * アルゴリズムはヘッダの alg で決めるが、鍵の種類が alg と合わなければ検証しない。
 * 「アルゴリズムの取り違え」（公開鍵を HMAC の鍵にして作った偽のトークン）を防ぐため、HMAC の鍵に
 * PEM・JWK の形の入力は受け付けない。鍵の形式を UTF-8 にしたときは、PEM の本文だけを貼るなど、鍵の形に見えない入力は見分けられない
 * （Base64 を選んだときは、復号したバイト列が公開鍵の形なら keys.ts が断る）。
 */
import type { PreparedJws } from './jws';
import { algSpec, neededKey, type AlgSpec, type KeyType } from './alg';
import { keyTypeOf, type PublicKey } from './keys';
import { errorMessage } from '../../lib/errors';
import { detailPreview } from '../../lib/text/textPreview';
import { cryptoErrorName, SIGNATURE_MISMATCH, verifyWithPublicKey, type PublicKeyData, type SignatureVerification } from '../../lib/crypto/signature';

/** Web Crypto API に渡す JWK（公開鍵の値だけ。alg・key_ops などは自分で確かめる） */
function cleanJwk(jwk: Record<string, unknown>): JsonWebKey {
  const pick = (names: string[]) => Object.fromEntries(names.filter((n) => n in jwk).map((n) => [n, jwk[n]]));
  return { ...(jwk.kty === 'RSA' ? pick(['kty', 'n', 'e']) : pick(['kty', 'crv', 'x', 'y'])), ext: true } as JsonWebKey;
}

export type VerifyKey = { kind: 'secret'; bytes: Uint8Array<ArrayBuffer> } | { kind: 'public'; key: PublicKey };

/**
 * jws.ts の prepareJws で準備した JWS の署名を検証する。鍵を変えたときに、トークン全体の読み直しを繰り返さない。
 *
 * @remarks
 * 鍵の種類とアルゴリズムの一致、署名形式、未対応のヘッダ拡張も確認する。
 * クレームの受け入れや鍵の信頼性は判定しない。
 *
 * @param jws - トークンごとに1回だけ準備した、署名の対象と署名のバイト列。
 * @param alg - デコードしたヘッダの署名アルゴリズム。
 * @param key - HMAC の共通鍵、または検証用の公開鍵。
 * @param subtle - Web Crypto API。省略時はブラウザの実装を使う。
 * @returns 署名の一致・不正・未対応と、その説明。
 */
export async function verifyPreparedJws(
  jws: PreparedJws,
  alg: unknown,
  key: VerifyKey,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<SignatureVerification> {
  let spec: AlgSpec;
  try {
    spec = algSpec(alg);
  } catch (e) {
    return { status: 'unsupported', message: errorMessage(e) };
  }

  if (jws.problem !== null) return { status: 'invalid', message: jws.problem };
  const { data, signature: sig } = jws;

  if (spec.family === 'hmac') {
    if (key.kind !== 'secret') return { status: 'invalid', message: `${alg as string} は秘密鍵（共通鍵）で検証します。公開鍵では検証できません` };
    if (key.bytes.length === 0) return { status: 'invalid', message: '秘密鍵が空です' };
    try {
      const k = await subtle.importKey('raw', key.bytes, { name: 'HMAC', hash: spec.hash }, false, ['verify']);
      const ok = await subtle.verify('HMAC', k, sig, data);
      return ok ? { status: 'valid', message: '署名は正しく、この秘密鍵で作られています' } : { status: 'invalid', message: SIGNATURE_MISMATCH };
    } catch (e) {
      return { status: 'unsupported', message: `秘密鍵を読み込めません（${detailPreview(cryptoErrorName(e))}）` };
    }
  }

  /** アルゴリズムの取り違えを防ぐため、公開鍵で検証する alg に秘密鍵（共通鍵）は使わない */
  if (key.kind !== 'public') return { status: 'invalid', message: `${alg as string} は公開鍵で検証します` };
  const pub = key.key;

  let keyType: KeyType;
  try {
    keyType = keyTypeOf(pub);
  } catch (e) {
    return { status: 'invalid', message: errorMessage(e) };
  }
  const need = neededKey(spec);
  if (keyType !== need) {
    if (spec.family === 'ecdsa' && keyType === 'secp256k1') {
      return { status: 'unsupported', message: 'この曲線（secp256k1）の署名は、ブラウザ（Web Crypto API）で検証できません' };
    }
    return { status: 'invalid', message: `鍵の種類（${detailPreview(keyType)}）が、トークンの alg（${alg as string}）に必要な鍵（${need}）と合いません` };
  }
  if (pub.format === 'jwk') {
    if (typeof pub.jwk.alg === 'string' && pub.jwk.alg !== alg) {
      return { status: 'invalid', message: `鍵に指定された alg（${detailPreview(pub.jwk.alg)}）が、トークンの alg（${alg as string}）と異なります` };
    }
    if (typeof pub.jwk.use === 'string' && pub.jwk.use !== 'sig') {
      return { status: 'invalid', message: `鍵の用途（use: ${detailPreview(pub.jwk.use)}）が、署名用（sig）ではありません` };
    }
    const ops = pub.jwk.key_ops;
    if (ops !== undefined && !(Array.isArray(ops) && ops.includes('verify'))) {
      return { status: 'invalid', message: '鍵の操作（key_ops）に、署名の検証（verify）が含まれていません' };
    }
  }

  let importAlg: RsaHashedImportParams | EcKeyImportParams | AlgorithmIdentifier;
  let verifyAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
  switch (spec.family) {
    case 'rsa':
      importAlg = { name: 'RSASSA-PKCS1-v1_5', hash: spec.hash };
      verifyAlg = { name: 'RSASSA-PKCS1-v1_5' };
      break;
    case 'pss':
      importAlg = { name: 'RSA-PSS', hash: spec.hash };
      verifyAlg = { name: 'RSA-PSS', saltLength: spec.saltLength };
      break;
    case 'ecdsa':
      /** JWS の ECDSA の署名は、DER ではなく r と s を曲線の大きさで並べた形式（RFC 7518 3.4） */
      if (sig.length !== spec.size * 2) {
        return {
          status: 'invalid',
          message: `署名の長さ（${sig.length} バイト）が ${alg as string} の形式（${spec.size * 2} バイト）と合いません。JWS の ECDSA の署名は、DER ではなく r と s を並べた形式です`,
        };
      }
      importAlg = { name: 'ECDSA', namedCurve: spec.curve };
      verifyAlg = { name: 'ECDSA', hash: spec.hash };
      break;
    case 'eddsa':
      importAlg = { name: 'Ed25519' };
      verifyAlg = { name: 'Ed25519' };
      break;
  }

  /** 公開鍵を読み込めないときは、署名が一致しないとは言えないため「検証できない」にする（証明書デコーダーと同じ扱い） */
  const keyData: PublicKeyData = pub.format === 'jwk' ? { format: 'jwk', jwk: cleanJwk(pub.jwk) } : { format: 'spki', der: pub.der };
  return verifyWithPublicKey(keyData, importAlg, verifyAlg, sig, data, '公開鍵', subtle);
}
