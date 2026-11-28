/** 証明書の名前（発行者・主体）の読み取りと比較 */
import { assertTag, rawOf, readOid, readString, TAG, toUpperHex, type Node } from '../../lib/crypto/asn1';

/** バイト列が同じか（名前の DER の比較と、署名アルゴリズムの比較に使う） */
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const NAME_ATTRS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.15': 'businessCategory',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'GN',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.25': 'DC',
  '0.9.2342.19200300.100.1.1': 'UID',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
};

export type NameAttr = { oid: string; short: string; value: string };
/** rdns は RDN（属性の集合）ごとの、属性の比較用のキー（attributeKey）。名前の比較に使う */
export type ParsedName = { attrs: NameAttr[]; text: string; raw: Uint8Array; rdns: string[][] };

/** 1つの名前の属性の数の上限。現実の証明書は多くても十数個。大量の属性で解析と比較が重くならないように */
export const MAX_NAME_ATTRS = 256;

export function readName(input: Node | undefined): ParsedName {
  const n = assertTag(input, TAG.SEQUENCE, '名前');
  const attrs: NameAttr[] = [];
  const rdns: string[][] = [];
  for (const rdn of n.children) {
    if (attrs.length + rdn.children.length > MAX_NAME_ATTRS) throw new Error(`名前の属性が多すぎます（${MAX_NAME_ATTRS}個まで）`);
    const keys: string[] = [];
    for (const atv of rdn.children) {
      const oid = readOid(assertTag(atv.children[0], TAG.OID, '名前の種類'));
      const v = atv.children[1];
      const value = v ? readString(v) : '';
      attrs.push({ oid, short: NAME_ATTRS[oid] ?? oid, value });
      keys.push(attributeKey(oid, v && v.tagClass === 'universal' ? v.tag : null, value, v ? rawOf(v) : new Uint8Array()));
    }
    rdns.push(keys);
  }
  return { attrs, text: attrs.map((a) => `${a.short}=${a.value}`).join(', '), raw: rawOf(n), rdns };
}

/** 符号化の違いを無視して文字列として比べる型（DirectoryString。RFC 5280 4.1.2.4） */
const DIRECTORY_STRINGS: readonly number[] = [TAG.PRINTABLE_STRING, TAG.UTF8_STRING, TAG.BMP_STRING, TAG.UNIVERSAL_STRING, TAG.T61_STRING];

/**
 * 比較のための文字列の準備（RFC 4518 の一部）。互換文字の正規化（NFKC）、大文字・小文字の区別をなくす、
 * 前後の空白を除き、続く空白を1つにまとめる。文字の除去や禁止文字の確認は行わない
 */
const prepare = (s: string) => s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * 属性の比較用のキー。キーが同じ属性は同じとみなす。文字列の型（DirectoryString）は準備した文字列で、
 * それ以外の型（IA5String など）は値の DER のバイト列で比べる
 */
export const attributeKey = (oid: string, tag: number | null, value: string, raw: Uint8Array): string =>
  `${oid}\u0000${tag !== null && DIRECTORY_STRINGS.includes(tag) ? `S${prepare(value)}` : `B${toUpperHex(raw)}`}`;

/**
 * 発行者の鍵識別子（AKI）と、発行者とみなす証明書の鍵識別子（SKI）が食い違わないか。どちらかがなければ食い違わないとする。
 *
 * @remarks
 * 「発行者とみなせるか」（名前の一致と、この判定）は、自己発行の判定（logic.ts）・つながりの評価（chain.ts）・
 * 署名の検証に使う発行者の候補（issuerCandidates.ts）で同じにする（表示と検証で判定が食い違わないように）。
 */
export const keyIdsCompatible = (authorityKeyId: string | null, subjectKeyId: string | null): boolean =>
  !authorityKeyId || !subjectKeyId || authorityKeyId === subjectKeyId;

/**
 * 名前が同じか（RFC 5280 7.1）。DER のバイト列が違っても、RDN の並びと各 RDN の属性の集合が同じで、
 * 文字列の値が符号化（PrintableString と UTF8String など）・大文字小文字・空白の違いを除いて同じなら、同じとする。
 * 複数の属性を持つ RDN は集合なので、キーの個数を数えて比べる（属性の数に比例する時間で済む）
 */
export function sameName(a: ParsedName, b: ParsedName): boolean {
  if (sameBytes(a.raw, b.raw)) return true;
  if (a.rdns.length !== b.rdns.length) return false;
  return a.rdns.every((rdn, i) => {
    const other = b.rdns[i];
    if (other === undefined) return false;
    if (rdn.length !== other.length) return false;
    const counts = new Map<string, number>();
    for (const key of rdn) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const key of other) {
      const n = counts.get(key);
      if (!n) return false;
      counts.set(key, n - 1);
    }
    return true;
  });
}
