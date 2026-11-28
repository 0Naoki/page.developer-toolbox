/** X.509 証明書から、公開鍵と主体の CN だけを取り出す（JWT の検証の鍵に使う）。証明書の内容の表示や検証は、証明書デコーダーの担当 */
import { Asn1Error, isContext, isUniversal, parseDerExact, rawOf, readOid, readString, TAG, type Node } from './asn1';

const CN = '2.5.4.3';

/** 主体の名前（RDN の並び）から、最初の CN を読む。なければ null */
function commonNameOf(subject: Node): string | null {
  for (const rdn of subject.children) {
    for (const atv of rdn.children) {
      const [type, value] = atv.children;
      if (!isUniversal(type, TAG.OID) || readOid(type) !== CN) continue;
      if (value === undefined) throw new Asn1Error('主体の CN の値を読めません');
      return readString(value);
    }
  }
  return null;
}

/**
 * 証明書の DER から、公開鍵（SubjectPublicKeyInfo の DER）と主体の CN を取り出す。
 *
 * @remarks
 * 証明書の構造（RFC 5280 4.1）のうち、TBSCertificate の版・シリアル番号・署名アルゴリズム・発行者・有効期間・主体・公開鍵の順だけを確かめる。
 * 証明書の署名・有効期限・拡張は確かめない。
 *
 * @throws 証明書の形として読めない場合。
 */
export function certificatePublicKey(der: Uint8Array): { spki: Uint8Array; commonName: string | null } {
  const root = parseDerExact(der);
  const tbs = root.children[0];
  if (!isUniversal(root, TAG.SEQUENCE) || !isUniversal(tbs, TAG.SEQUENCE)) throw new Error('証明書の形ではありません');
  /** 版（[0]）は v1 の証明書では省略される */
  const fields = isContext(tbs.children[0], 0) ? tbs.children.slice(1) : tbs.children;
  const [serial, signature, issuer, validity, subject, spki] = fields;
  if (
    !isUniversal(serial, TAG.INTEGER) || !isUniversal(signature, TAG.SEQUENCE) || !isUniversal(issuer, TAG.SEQUENCE) ||
    !isUniversal(validity, TAG.SEQUENCE) || !isUniversal(subject, TAG.SEQUENCE) || !isUniversal(spki, TAG.SEQUENCE)
  ) throw new Error('証明書の形ではありません');
  return { spki: new Uint8Array(rawOf(spki)), commonName: commonNameOf(subject) };
}
