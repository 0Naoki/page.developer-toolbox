import { sameName } from './name';
import type { Certificate } from './logic';

/** 名前と、双方にある鍵識別子が一致する発行者候補。入力順を保ち、自分自身を除く。署名の一致や信頼は判定しない。 */
export function issuerCandidates(item: Certificate, certs: readonly Certificate[]): Certificate[] {
  return certs.filter(
    (c) =>
      c !== item &&
      sameName(c.subject, item.issuer) &&
      (!item.authorityKeyId || !c.subjectKeyId || item.authorityKeyId === c.subjectKeyId),
  );
}
