/**
 * JWT（JWS）の署名の検証（Web Crypto API）。
 * アルゴリズムはヘッダの alg で決めるが、鍵の種類が alg と合わなければ検証しない。
 * 「アルゴリズムの取り違え」（公開鍵を HMAC の鍵にして作った偽のトークン）を防ぐため、HMAC の鍵に
 * PEM・JWK の形の入力は受け付けない。PEM の本文だけを貼るなど、鍵の形に見えない入力は見分けられない。
 */
import { base64ToBytes, bytesToBase64 } from '../../lib/bytes';
import { isRecord } from '../../lib/settings';
import { algSpec, neededKey, type AlgSpec, type KeyType } from './alg';
import { keyTypeOf, type PublicKey } from './keys';
import { errorMessage } from '../../lib/errors';
import { detailPreview } from '../../lib/text/textPreview';
import type { SignatureVerification } from '../../lib/crypto/signature';

/** 検証 */

/** Web Crypto API に渡す JWK（公開鍵の値だけ。alg・key_ops などは自分で確かめる） */
function cleanJwk(jwk: Record<string, unknown>): JsonWebKey {
  const pick = (names: string[]) => Object.fromEntries(names.filter((n) => n in jwk).map((n) => [n, jwk[n]]));
  return { ...(jwk.kty === 'RSA' ? pick(['kty', 'n', 'e']) : pick(['kty', 'crv', 'x', 'y'])), ext: true } as JsonWebKey;
}

export type VerifyKey = { kind: 'secret'; bytes: Uint8Array<ArrayBuffer> } | { kind: 'public'; key: PublicKey };

const INVALID = '署名が一致しません（内容が書き換えられているか、別の鍵で署名されています）';

/**
 * JWS の Base64URL（RFC 7515）を読む。base64ToBytes は緩いため、空白・パディング・標準の Base64 の記号や、
 * 余りのビットだけが違う書き換えも同じバイト列になる。読み直して元の文字列に戻るものだけを受け付ける
 */
function jwsBytes(part: string): Uint8Array<ArrayBuffer> {
  const bytes = base64ToBytes(part);
  if (part === '' || bytesToBase64(bytes, { urlSafe: true }) !== part) throw new Error('Base64URL の形式ではありません');
  return bytes;
}

/**
 * 署名の対象（「ヘッダ.ペイロード」）が JWS として無効なら、その理由を返す。
 * 表示用のデコードは緩く読むため、検証ではここで Base64URL と UTF-8 を厳密に確かめる。
 * crit に挙げられた拡張を理解できない JWS は無効で（RFC 7515 4.1.11）、このツールは拡張を実装していないため、crit があれば拒否する。
 * b64 が true 以外（RFC 7797）なら、ペイロードは Base64URL をデコードしない文字列そのものを意味する。標準の読み方で検証すると、
 * 別の内容のペイロードを「正しい」と表示するため、crit がなくても拒否する（RFC 7797 では、b64 を使うなら crit にも書く必要がある）
 */
function signingInputProblem(signingInput: string): string | null {
  const [head = '', payload = ''] = signingInput.split('.');
  let header: unknown;
  try {
    const bytes = jwsBytes(head);
    jwsBytes(payload);
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return 'ヘッダまたはペイロードを Base64URL として読めません';
  }
  if (!isRecord(header)) return null;
  if ('crit' in header) return 'ヘッダの crit に挙げられた拡張に対応していないため、このトークンは無効です';
  if ('b64' in header && header.b64 !== true) return B64_PROBLEM;
  return null;
}

const B64_PROBLEM = 'ヘッダの b64 が true 以外です。ペイロードを Base64URL にしない形式（RFC 7797）には対応していないため、このトークンは無効です';

/**
 * 入力した鍵で JWS の署名を検証する。
 *
 * @remarks
 * 鍵の種類とアルゴリズムの一致、署名形式、未対応のヘッダ拡張も確認する。
 * クレームの受け入れや鍵の信頼性は判定しない。
 *
 * @param signingInput - Base64URL 表記のままの「ヘッダ.ペイロード」。
 * @param signature - Base64URL 表記の署名部分。
 * @param alg - デコードしたヘッダの署名アルゴリズム。
 * @param key - HMAC の共通鍵、または検証用の公開鍵。
 * @param subtle - Web Crypto API。省略時はブラウザの実装を使う。
 * @returns 署名の一致・不正・未対応と、その説明。
 */
export async function verifyJwt(
  signingInput: string,
  signature: string,
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

  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = jwsBytes(signature);
  } catch {
    return { status: 'invalid', message: '署名の部分を Base64URL として読めません' };
  }
  const problem = signingInputProblem(signingInput);
  if (problem) return { status: 'invalid', message: problem };
  const data = new TextEncoder().encode(signingInput);

  if (spec.family === 'hmac') {
    if (key.kind !== 'secret') return { status: 'invalid', message: `${alg as string} は秘密鍵（共通鍵）で検証します。公開鍵では検証できません` };
    if (key.bytes.length === 0) return { status: 'invalid', message: '秘密鍵が空です' };
    try {
      const k = await subtle.importKey('raw', key.bytes, { name: 'HMAC', hash: spec.hash }, false, ['verify']);
      const ok = await subtle.verify('HMAC', k, sig, data);
      return ok ? { status: 'valid', message: '署名は正しく、この秘密鍵で作られています' } : { status: 'invalid', message: INVALID };
    } catch (e) {
      return { status: 'unsupported', message: `秘密鍵を読み込めません（${(e as Error).name}）` };
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

  let cryptoKey: CryptoKey;
  try {
    cryptoKey =
      pub.format === 'jwk'
        ? await subtle.importKey('jwk', cleanJwk(pub.jwk), importAlg, false, ['verify'])
        : await subtle.importKey('spki', pub.der, importAlg, false, ['verify']);
  } catch (e) {
    if (spec.family === 'eddsa' && (e as Error).name === 'NotSupportedError') {
      return { status: 'unsupported', message: 'このブラウザは Ed25519 の署名の検証に対応していません' };
    }
    return { status: 'invalid', message: `公開鍵を読み込めません（${(e as Error).name}）` };
  }
  try {
    const ok = await subtle.verify(verifyAlg, cryptoKey, sig, data);
    return ok ? { status: 'valid', message: '署名は正しく、この公開鍵と対になる秘密鍵で署名されています' } : { status: 'invalid', message: INVALID };
  } catch {
    return { status: 'invalid', message: '署名の形式が正しくありません' };
  }
}
