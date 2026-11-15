/**
 * 署名の検証（Web Crypto API）で、証明書デコーダーと JWT デコーダーが共有する型。
 * どの署名アルゴリズムを受け付けるか、結果の文言は各ツールが決める。
 */

/**
 * 入力した鍵に対する署名の検証結果。
 *
 * @remarks
 * `valid` は署名の一致、`invalid` は署名の不一致・入力や署名の形式の不正、`unsupported` は検証に対応しない状態。
 * 有効期限・発行者・利用対象・証明書の信頼性の判定は含まない。
 */
export type SignatureVerification = { status: 'valid' | 'invalid' | 'unsupported'; message: string };

/**
 * Web Crypto API に渡すハッシュの名前。
 * SHA-1 は古い証明書の署名の検証だけで使い、JWS（RFC 7518）のアルゴリズムには含まれない。
 */
export type WebCryptoHash = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
