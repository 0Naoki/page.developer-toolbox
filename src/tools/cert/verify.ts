/**
 * 証明書・CSR の署名の検証（Web Crypto API）。
 * 「証明書の本体が、発行者の秘密鍵で署名されたか」を、発行者の公開鍵で確かめる。
 * 失効（OCSP・CRL）や、信頼するルート証明書までたどれるかは確かめない（通信や信頼の設定が必要なため）。
 */
import { TAG, isContext, isUniversal, parseDerExact, readInteger, readOid, SMALL_INTEGER_BYTES, valueOf, type Node } from '../../lib/crypto/asn1';
import { keyKindOf, type KeyKind } from '../../lib/crypto/spki';
import type { SignatureVerification, WebCryptoHash } from '../../lib/crypto/signature';
import { detailPreview } from '../../lib/text/textPreview';
import { sameName } from './name';
import { type Certificate, type Csr, type Signed } from './logic';

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

type Scheme =
  | { kind: 'rsa'; hash: WebCryptoHash }
  | { kind: 'pss'; hash: WebCryptoHash; saltLength: number }
  | { kind: 'ecdsa'; hash: WebCryptoHash }
  | { kind: 'ed25519' };

class Unsupported extends Error {}
/** 署名アルゴリズムのパラメーターが規格に合わない（OpenSSL も拒否する）。署名は正しくないとする */
class InvalidParams extends Error {}

const MGF1 = '1.2.840.113549.1.1.8';

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
      if (readOid(oid) !== MGF1) invalid('マスク生成関数が MGF1 ではありません');
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
    return readOid(n.children[0]);
  }
  function integer(n: Node, name: string): bigint {
    if (!isUniversal(n, TAG.INTEGER) || n.constructed) invalid(`${name} が INTEGER ではありません`);
    return readInteger(n, SMALL_INTEGER_BYTES);
  }
}

/**
 * 署名アルゴリズム（AlgorithmIdentifier）を読む。パラメーターの有無と型も、アルゴリズムごとに確かめる。
 * ECDSA（RFC 5758 3.2）と Ed25519（RFC 8410 3）はパラメーターを書かない。RSA の PKCS#1（RFC 4055 5）は NULL か省略だけ
 */
function schemeOf(algorithm: Node): Scheme {
  const [oidNode, params, ...rest] = algorithm.children;
  if (!isUniversal(algorithm, TAG.SEQUENCE) || !isUniversal(oidNode, TAG.OID) || rest.length > 0) {
    throw new InvalidParams('署名アルゴリズムの形式が正しくありません');
  }
  const oid = readOid(oidNode);
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

/** 長さが最短の形式（DER）で書かれているか。署名は小さいので、長さは2バイトまで */
const hasMinimalLength = (n: Node): boolean => {
  const size = n.end - n.valueStart;
  return n.valueStart - n.start === (size < 0x80 ? 2 : size < 0x100 ? 3 : 4);
};

/** 正の整数の DER か。先頭の0は、最上位ビットが1の値を正にするときだけ書く */
function isPositiveInteger(n: Node | undefined): n is Node {
  if (!isUniversal(n, TAG.INTEGER) || n.constructed || !hasMinimalLength(n)) return false;
  const [first, second] = valueOf(n);
  return first !== undefined && (first & 0x80) === 0 && (first !== 0 || second === undefined || (second & 0x80) !== 0);
}

/**
 * ECDSA の署名を、DER（SEQUENCE \{ r, s \}。RFC 3279 2.2.3）から Web Crypto API の形式（r と s を曲線の大きさで並べたもの）にする。
 * r と s の値が同じでも形式の違う署名を受け付けないよう、余分なデータ・型・個数・符号化が DER どおりかを確かめる。不正なら例外
 */
function ecdsaRaw(signature: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const seq = parseDerExact(signature);
  if (!isUniversal(seq, TAG.SEQUENCE) || !seq.constructed || !hasMinimalLength(seq) || seq.children.length !== 2 || !seq.children.every(isPositiveInteger)) {
    throw new Error('ECDSA の署名が DER の形式ではありません');
  }
  const out = new Uint8Array(size * 2);
  seq.children.forEach((n, i) => {
    let v = valueOf(n);
    while (v.length > 0 && v[0] === 0) v = v.subarray(1); /** 正の数にするための先頭の0 */
    if (v.length > size) throw new Error('ECDSA の署名の値が曲線の大きさを超えています');
    out.set(v, i * size + size - v.length);
  });
  return out;
}

const copy = (v: Uint8Array) => new Uint8Array(v);

const KEY_NAMES: Record<KeyKind['kind'], string> = { rsa: 'RSA', ec: 'ECDSA', 'ec-unsupported': 'ECDSA', ed25519: 'Ed25519', other: 'その他' };
const SCHEME_KEY: Record<Scheme['kind'], KeyKind['kind']> = { rsa: 'rsa', pss: 'rsa', ecdsa: 'ec', ed25519: 'ed25519' };

/**
 * 証明書・CSR の署名を指定した公開鍵で検証する。
 *
 * @param signed - 署名対象の元バイト列・署名・アルゴリズム。
 * @param issuerSpki - 発行者の公開鍵の SPKI（DER）。CSR では自身の公開鍵。
 * @param subtle - Web Crypto API。省略時はブラウザの実装を使う。
 * @returns 署名の一致・不正・未対応。鍵を読み込めない場合も未対応として返す。
 */
export async function verifySigned(signed: Signed, issuerSpki: Uint8Array, subtle: SubtleCrypto = crypto.subtle): Promise<SignatureVerification> {
  if (signed.malformed) return { status: 'invalid', message: signed.malformed };
  let scheme: Scheme;
  let key: KeyKind;
  try {
    scheme = schemeOf(signed.algorithm);
    key = keyKindOf(issuerSpki);
  } catch (e) {
    if (e instanceof InvalidParams) return { status: 'invalid', message: e.message };
    return { status: 'unsupported', message: e instanceof Unsupported ? e.message : '署名アルゴリズムを読めません' };
  }
  /** ECDSA の署名でも、ブラウザが対応していない曲線の鍵は、正しいかどうかを判断できない（一致しないのではない） */
  if (scheme.kind === 'ecdsa' && key.kind === 'ec-unsupported') {
    return { status: 'unsupported', message: `この曲線（${key.curve}）の署名は、ブラウザ（Web Crypto API）で検証できません` };
  }
  if (SCHEME_KEY[scheme.kind] !== key.kind) {
    return { status: 'invalid', message: `発行者の鍵の種類（${KEY_NAMES[key.kind]}）が、署名の種類と合いません` };
  }

  let importAlg: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
  let verifyAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
  switch (scheme.kind) {
    case 'rsa':
      importAlg = { name: 'RSASSA-PKCS1-v1_5', hash: scheme.hash };
      verifyAlg = { name: 'RSASSA-PKCS1-v1_5' };
      break;
    case 'pss':
      importAlg = { name: 'RSA-PSS', hash: scheme.hash };
      verifyAlg = { name: 'RSA-PSS', saltLength: scheme.saltLength };
      break;
    case 'ecdsa':
      importAlg = { name: 'ECDSA', namedCurve: (key as Extract<KeyKind, { kind: 'ec' }>).curve };
      verifyAlg = { name: 'ECDSA', hash: scheme.hash };
      break;
    case 'ed25519':
      importAlg = { name: 'Ed25519' };
      verifyAlg = { name: 'Ed25519' };
      break;
  }

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await subtle.importKey('spki', copy(issuerSpki), importAlg, false, ['verify']);
  } catch (e) {
    if (scheme.kind === 'ed25519') return { status: 'unsupported', message: 'このブラウザは Ed25519 の署名の検証に対応していません' };
    return { status: 'unsupported', message: `発行者の公開鍵を読み込めません（${(e as Error).name}）` };
  }
  try {
    const signature = scheme.kind === 'ecdsa' ? ecdsaRaw(signed.signature, (key as Extract<KeyKind, { kind: 'ec' }>).size) : copy(signed.signature);
    const ok = await subtle.verify(verifyAlg, cryptoKey, signature, copy(signed.tbs));
    return ok
      ? { status: 'valid', message: '署名は正しく、この公開鍵と対になる秘密鍵で署名されています' }
      : { status: 'invalid', message: '署名が一致しません（内容が書き換えられているか、別の鍵で署名されています）' };
  } catch {
    return { status: 'invalid', message: '署名の形式が正しくありません' };
  }
}

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
  const candidates = certs.filter(
    (c) =>
      c !== item &&
      sameName(c.subject, item.issuer) &&
      (!item.authorityKeyId || !c.subjectKeyId || item.authorityKeyId === c.subjectKeyId),
  );
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
