/**
 * 署名の検証（Web Crypto API）で、証明書デコーダーと JWT デコーダーが共有する型と処理。
 * どの署名アルゴリズムを受け付けるか、鍵とアルゴリズムの組み合わせの確認は各ツールが行い、
 * 公開鍵の読み込みと検証（verifyWithPublicKey）だけを共有する（鍵を読めないときの扱いがツールごとに食い違わないように）。
 */
import { detailPreview } from '../text/textPreview';

/**
 * 入力した鍵に対する署名の検証結果。
 *
 * @remarks
 * `valid` は署名の一致、`invalid` は署名の不一致・入力や署名の形式の不正、`unsupported` は検証に対応しない状態
 * （ブラウザが対応しないアルゴリズム・曲線、読み込めない公開鍵）。
 * 公開鍵を読み込めないときは、署名が一致しないとは言えないため `unsupported` にする。
 * 有効期限・発行者・利用対象・証明書の信頼性の判定は含まない。
 */
export type SignatureVerification = { status: 'valid' | 'invalid' | 'unsupported'; message: string };

/** 署名が一致したときの説明 */
const SIGNATURE_VALID = '署名は正しく、この公開鍵と対になる秘密鍵で署名されています';
/** 署名が一致しないときの説明 */
export const SIGNATURE_MISMATCH = '署名が一致しません（内容が書き換えられているか、別の鍵で署名されています）';

/** 検証に使う公開鍵。証明書・PEM は SPKI（DER）、JWT の JWK はそのまま渡す */
export type PublicKeyData = { format: 'spki'; der: Uint8Array } | { format: 'jwk'; jwk: JsonWebKey };

const copy = (v: Uint8Array) => new Uint8Array(v);

/**
 * Web Crypto API の例外（DOMException）の種類の名前（NotSupportedError・DataError など）。読めなければ 'Error'。
 * 例外の文言は英語で、ブラウザによっても違うため、画面には種類の名前だけを示す（証明書と JWT の検証で共通）
 */
export const cryptoErrorName = (e: unknown): string => {
  const name = (e as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : 'Error';
};
const algorithmName = (alg: AlgorithmIdentifier | { name: string }) => (typeof alg === 'string' ? alg : alg.name);

/**
 * 公開鍵を読み込み、署名を検証する。
 *
 * @remarks
 * - 公開鍵を読み込めない：`unsupported`（Ed25519 に対応していないブラウザは、その旨を伝える）
 * - 検証の呼び出しが失敗する（署名の長さが合わないなど）：`invalid`（署名の形式が正しくない）
 *
 * @param key - 公開鍵。
 * @param importAlg - 鍵の読み込みに使うアルゴリズム。
 * @param verifyAlg - 検証に使うアルゴリズム。
 * @param signature - Web Crypto API の形式にした署名（ECDSA は r と s を並べた形式）。
 * @param data - 署名の対象。
 * @param keyLabel - 鍵を読み込めないときの文言に入れる鍵の呼び名（「公開鍵」「発行者の公開鍵」など）。
 * @param subtle - Web Crypto API。
 * @returns 署名の一致・不正・未対応と、その説明。
 */
export async function verifyWithPublicKey(
  key: PublicKeyData,
  importAlg: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams,
  verifyAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
  signature: Uint8Array,
  data: Uint8Array,
  keyLabel: string,
  subtle: SubtleCrypto,
): Promise<SignatureVerification> {
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = key.format === 'jwk'
      ? await subtle.importKey('jwk', key.jwk, importAlg, false, ['verify'])
      : await subtle.importKey('spki', copy(key.der), importAlg, false, ['verify']);
  } catch (e) {
    const reason = cryptoErrorName(e);
    if (algorithmName(importAlg) === 'Ed25519' && reason === 'NotSupportedError') {
      return { status: 'unsupported', message: 'このブラウザは Ed25519 の署名の検証に対応していません' };
    }
    return { status: 'unsupported', message: `${keyLabel}を読み込めません（${detailPreview(reason)}）` };
  }
  try {
    const ok = await subtle.verify(verifyAlg, cryptoKey, copy(signature), copy(data));
    return ok ? { status: 'valid', message: SIGNATURE_VALID } : { status: 'invalid', message: SIGNATURE_MISMATCH };
  } catch {
    return { status: 'invalid', message: '署名の形式が正しくありません' };
  }
}

/**
 * Web Crypto API に渡すハッシュの名前。
 * SHA-1 は古い証明書の署名の検証だけで使い、JWS（RFC 7518）のアルゴリズムには含まれない。
 */
export type WebCryptoHash = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
