/** 署名アルゴリズムのパラメーターと対応範囲を解釈する。暗号APIや発行者の選択には依存しない。 */
import { TAG, isContext, isUniversal, readInteger, readOid, SMALL_INTEGER_BYTES, valueOf, type Node } from '../../lib/crypto/asn1';
import type { WebCryptoHash } from '../../lib/crypto/signature';

const HASHES: Record<string, WebCryptoHash> = {
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
};

const RSA_PKCS1: Record<string, WebCryptoHash> = {
  '1.2.840.113549.1.1.5': 'SHA-1',
  '1.2.840.113549.1.1.11': 'SHA-256',
  '1.2.840.113549.1.1.12': 'SHA-384',
  '1.2.840.113549.1.1.13': 'SHA-512',
};

const ECDSA: Record<string, WebCryptoHash> = {
  '1.2.840.10045.4.1': 'SHA-1',
  '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384',
  '1.2.840.10045.4.3.4': 'SHA-512',
};

export type Scheme =
  | { kind: 'rsa'; hash: WebCryptoHash }
  | { kind: 'pss'; hash: WebCryptoHash; saltLength: number }
  | { kind: 'ecdsa'; hash: WebCryptoHash }
  | { kind: 'ed25519' };

export class Unsupported extends Error {}
/** 署名アルゴリズムのパラメーターが規格に合わない（OpenSSL も拒否する）。署名は正しくないとする */
export class InvalidParams extends Error {}

const MGF1 = '1.2.840.113549.1.1.8';

/**
 * 署名方式・ハッシュ・MGF1 の OID を読む。DER の規則（primitive で、各成分を最短のバイト列で書く）に合わない書き方は InvalidParams。
 * 署名アルゴリズムは署名の対象の外（CSR の外側など）にあるため、書き方の違う OID を同じ方式とみなすと、書き換えた証明書も「正しい」と表示する
 */
function canonicalOid(n: Node, what: string): string {
  /** 各成分の先頭のバイトが 0x80（値のない続き）なら、余分なゼロを付けた書き方 */
  const v = valueOf(n);
  if (n.constructed || v.some((b, i) => b === 0x80 && (i === 0 || (v[i - 1]! & 0x80) === 0))) {
    throw new InvalidParams(`${what}の OID の書き方が DER の規則に合いません`);
  }
  return readOid(n);
}

/** 省略されているか、中身のない NULL か */
const isNullOrAbsent = (n: Node | undefined): boolean => n === undefined || (isUniversal(n, TAG.NULL) && !n.constructed && n.end === n.valueStart);

/**
 * RSASSA-PSS のパラメーター（RFC 4055 3.1）を読む。
 *
 * @remarks
 * パラメーターの SEQUENCE は必須。その中の項目を省略したときは SHA-1・MGF1(SHA-1)・ソルト長20・trailerField 1。
 * Web Crypto API は trailerField やマスク生成関数を指定できないため、読み飛ばすと別の方式の署名を「正しい」と判定する。
 * [0]〜[3] を順に1回ずつだけ受け付け、各項目の型と要素の数まで確かめる。マスク生成関数は MGF1、trailerField は 1 だけにする
 */
function pssParams(params: Node | undefined): { hash: WebCryptoHash; saltLength: number } {
  let hash: WebCryptoHash = 'SHA-1';
  let mgfHash: WebCryptoHash = 'SHA-1';
  let saltLength = 20;
  /** 署名の AlgorithmIdentifier では、パラメーターそのものは省略できない（中の項目の省略とは別。空の SEQUENCE なら既定値） */
  if (params === undefined) invalid('パラメーターがありません');
  if (!isUniversal(params, TAG.SEQUENCE) || !params.constructed) invalid('SEQUENCE ではありません');
  let previous = -1;
  for (const p of params?.children ?? []) {
    const index = [0, 1, 2, 3].find((n) => isContext(p, n));
    if (index === undefined || index <= previous) invalid('未知の項目か、項目の順番・重複が違います');
    previous = index;
    /** [n] の中には要素が1つだけある（明示タグ） */
    const item = p.children[0];
    if (!p.constructed || p.children.length !== 1 || item === undefined) invalid(`[${index}] の形式が違います`);
    if (index === 0) hash = HASHES[hashOid(item)] ?? fail();
    if (index === 1) {
      const oid = item.children[0];
      if (!isUniversal(item, TAG.SEQUENCE) || item.children.length !== 2 || !isUniversal(oid, TAG.OID)) invalid('マスク生成関数の形式が違います');
      if (canonicalOid(oid, 'マスク生成関数') !== MGF1) invalid('マスク生成関数が MGF1 ではありません');
      mgfHash = HASHES[hashOid(item.children[1])] ?? fail();
    }
    if (index === 2) saltLength = Number(integer(item, 'saltLength'));
    if (index === 3 && integer(item, 'trailerField') !== 1n) invalid('trailerField は 1 だけが使えます');
  }
  if (saltLength < 0) invalid('saltLength が負の数です');
  /** Web Crypto API の RSA-PSS は、マスク生成関数（MGF1）にも同じハッシュを使う */
  if (mgfHash !== hash) throw new Unsupported('RSA-PSS のハッシュとマスク生成関数のハッシュが異なる署名は、Web Crypto API で検証できません');
  return { hash, saltLength };

  function invalid(what: string): never {
    throw new InvalidParams(`RSA-PSS のパラメーターが正しくありません（${what}）`);
  }
  function fail(): never {
    throw new Unsupported('RSA-PSS のハッシュアルゴリズムに対応していません');
  }
  /** ハッシュの AlgorithmIdentifier（OID と、省略できる NULL だけ）の OID */
  function hashOid(n: Node | undefined): string {
    if (!isUniversal(n, TAG.SEQUENCE) || n.children.length > 2 || !isUniversal(n.children[0], TAG.OID) || !isNullOrAbsent(n.children[1])) {
      invalid('ハッシュアルゴリズムの形式が違います');
    }
    return canonicalOid(n.children[0], 'ハッシュアルゴリズム');
  }
  /** 空の値や余分な符号のバイト（00 7F・FF 80 など）は、値が同じでも DER の規則に合わないため断る */
  function integer(n: Node, name: string): bigint {
    if (!isUniversal(n, TAG.INTEGER) || n.constructed) invalid(`${name} が INTEGER ではありません`);
    const [first, second] = valueOf(n);
    if (first === undefined) invalid(`${name} が空です`);
    if (second !== undefined && ((first === 0x00 && (second & 0x80) === 0) || (first === 0xff && (second & 0x80) !== 0))) {
      invalid(`${name} の書き方が DER の規則に合いません`);
    }
    return readInteger(n, SMALL_INTEGER_BYTES);
  }
}

/**
 * 署名アルゴリズム（AlgorithmIdentifier）を読む。パラメーターの有無と型も、アルゴリズムごとに確かめる。
 * ECDSA（RFC 5758 3.2）と Ed25519（RFC 8410 3）はパラメーターを書かない。RSA の PKCS#1（RFC 4055 5）は NULL か省略だけ
 */
export function schemeOf(algorithm: Node): Scheme {
  const [oidNode, params, ...rest] = algorithm.children;
  if (!isUniversal(algorithm, TAG.SEQUENCE) || !isUniversal(oidNode, TAG.OID) || rest.length > 0) {
    throw new InvalidParams('署名アルゴリズムの形式が正しくありません');
  }
  const oid = canonicalOid(oidNode, '署名アルゴリズム');
  const noParams = (name: string) => {
    if (params !== undefined) throw new InvalidParams(`${name} の署名アルゴリズムにはパラメーターを書けません`);
  };
  if (RSA_PKCS1[oid]) {
    if (!isNullOrAbsent(params)) throw new InvalidParams('RSA の署名アルゴリズムのパラメーターは、NULL か省略だけが使えます');
    return { kind: 'rsa', hash: RSA_PKCS1[oid] };
  }
  if (ECDSA[oid]) {
    noParams('ECDSA');
    return { kind: 'ecdsa', hash: ECDSA[oid] };
  }
  if (oid === '1.2.840.113549.1.1.10') return { kind: 'pss', ...pssParams(params) };
  if (oid === '1.3.101.112') {
    noParams('Ed25519');
    return { kind: 'ed25519' };
  }
  if (oid === '1.2.840.113549.1.1.4') throw new Unsupported('MD5 の署名は Web Crypto API で検証できません（MD5 は安全ではありません）');
  throw new Unsupported(`この署名アルゴリズム（${oid}）は、ブラウザで検証できません`);
}
