import { isUniversal, parseDerExact, TAG, type Node } from './asn1';

/**
 * 秘密鍵の検出（証明書デコーダーと JWT の鍵の入力で共通）。
 * 秘密鍵は解析も保存もしないため、鍵の値は読まずに、見た目と外側の型だけで判定する。
 */

/** 秘密鍵らしい文字列を含むか（PRIVATE KEY・ENCRYPTED PRIVATE KEY・RSA/EC PRIVATE KEY など） */
export const containsPrivateKey = (text: string): boolean => /PRIVATE KEY/i.test(text);

/**
 * DER が秘密鍵の形か（PKCS#8、暗号化された PKCS#8、RSA の PKCS#1、EC の SEC 1）。
 * 見出しのない DER には PRIVATE KEY の文字がないため、外側の要素の型だけを見る（鍵の値は読まない）。
 * 証明書と CSR の外側は SEQUENCE・SEQUENCE・BIT STRING なので、どれにも当たらない
 */
export function isPrivateKeyDer(der: Uint8Array): boolean {
  let children: Node[];
  try {
    children = parseDerExact(der).children;
  } catch {
    return false;
  }
  const [first, second, third] = children;
  if (isUniversal(first, TAG.INTEGER)) {
    return isUniversal(second, TAG.OCTET_STRING) || (isUniversal(second, TAG.SEQUENCE) && isUniversal(third, TAG.OCTET_STRING)) || (isUniversal(second, TAG.INTEGER) && isUniversal(third, TAG.INTEGER));
  }
  return children.length === 2 && isUniversal(first, TAG.SEQUENCE) && isUniversal(second, TAG.OCTET_STRING);
}
