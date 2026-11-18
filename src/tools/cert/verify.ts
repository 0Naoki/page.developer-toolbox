/** 発行者候補を順に検証し、自己発行・自己署名・未対応の結果を調整する。 */
import type { SignatureVerification } from '../../lib/crypto/signature';
import { detailPreview } from '../../lib/text/textPreview';
import type { Certificate, Csr } from './logic';
import { issuerCandidates } from './issuerCandidates';
import { verifySigned } from './verifySigned';

/** selfSigned は、自分自身の公開鍵で署名を確認できたとき（自己署名）だけ true */
export type ItemVerification = { by: string; result: SignatureVerification; selfSigned?: boolean };

/** 「〜で検証」の文言に入れる発行者の名前。CN は長くできるため抜粋にする（全文は発行者の証明書のサブジェクトからコピーできる） */
const nameOf = (c: Certificate) => detailPreview(c.subject.attrs.find((a) => a.short === 'CN')?.value ?? c.subject.text);

/**
 * 証明書・CSR の署名を、一覧から選んだ公開鍵で検証する。
 *
 * @remarks
 * CSR は自身の公開鍵で検証する。自己発行の証明書は自身の鍵を試し、確認できなければ発行者候補も試す。
 * それ以外は名前と、両方に存在すれば鍵識別子が一致する発行者候補を試す。
 * 有効期限・鍵用途・信頼するルートまでのパス・失効は検証しない。
 *
 * @param item - 検証する証明書または CSR。
 * @param certs - 同じ入力から解析した発行者候補の証明書一覧。
 * @param subtle - Web Crypto API。省略時はブラウザの実装を使う。
 * @returns 使用した鍵と検証結果。発行者候補がなければ null。自己署名の一致時だけ `selfSigned` が true。
 */
export async function verifyInList(item: Certificate | Csr, certs: Certificate[], subtle?: SubtleCrypto): Promise<ItemVerification | null> {
  if (item.kind === 'csr') return { by: 'CSR 自身の公開鍵', result: await verifySigned(item.signed, item.signed.spki, subtle) };
  if (item.selfIssued) {
    const own = await verifySigned(item.signed, item.signed.spki, subtle);
    if (own.status === 'valid') return { by: '自分自身の公開鍵（自己署名）', result: own, selfSigned: true };
    /** 自己発行（名前が同じ）でも自己署名とは限らない。CA の鍵の更新では、旧い鍵の CA が新しい鍵の証明書に署名する（RFC 5280） */
    const other = await verifyByIssuers(item, certs, subtle);
    if (other?.result.status === 'valid') return { ...other, by: `${other.by}（自己発行。自分の鍵ではなく、この CA の鍵で署名）` };
    /** 発行者の候補の鍵を読み込めない（ブラウザが対応していない鍵など）なら、自分の鍵で一致しないだけでは不一致と断定しない */
    if (other?.result.status === 'unsupported' && own.status === 'invalid') {
      return {
        by: `${other.by}（自己発行。自分の鍵では一致しません）`,
        result: { status: 'unsupported', message: `自分の公開鍵では一致せず、発行者の候補の公開鍵では検証できません（${other.result.message}）` },
      };
    }
    return { by: '自分自身の公開鍵（自己署名）', result: own };
  }
  return verifyByIssuers(item, certs, subtle);
}

/** 一覧から発行者の候補を探して検証する。候補がなければ null */
async function verifyByIssuers(item: Certificate, certs: Certificate[], subtle?: SubtleCrypto): Promise<ItemVerification | null> {
  /** 名前が同じで鍵の違う CA（鍵の更新など）があるため、最初の候補だけでなく、署名を確認できる鍵を探す */
  const candidates = issuerCandidates(item, certs);
  const [firstCandidate] = candidates;
  if (firstCandidate === undefined) return null;
  const results: SignatureVerification[] = [];
  for (const issuer of candidates) {
    const result = await verifySigned(item.signed, issuer.signed.spki, subtle);
    if (result.status === 'valid' || candidates.length === 1) return { by: `発行者「${nameOf(issuer)}」の公開鍵`, result };
    results.push(result);
  }
  /** どの候補でも確認できない。検証できない鍵があれば、一致しないとは断定しない */
  const name = nameOf(firstCandidate);
  const unsupported = results.find((r) => r.status === 'unsupported');
  if (unsupported) return { by: `発行者「${name}」の候補 ${candidates.length} 枚の公開鍵`, result: unsupported };
  return {
    by: `発行者「${name}」の候補 ${candidates.length} 枚の公開鍵`,
    result: { status: 'invalid', message: `発行者の候補 ${candidates.length} 枚の、どの公開鍵でも署名を確認できません（内容が書き換えられているか、別の鍵で署名されています）` },
  };
}
