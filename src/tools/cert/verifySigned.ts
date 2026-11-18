/** 指定した公開鍵で署名を検証する。アルゴリズムの解析は signatureScheme.ts、候補の選択は issuerCandidates.ts が担当する。 */
import { TAG, isUniversal, parseDerExact, valueOf, type Node } from '../../lib/crypto/asn1';
import { keyKindOf, type KeyKind } from '../../lib/crypto/spki';
import { verifyWithPublicKey, type SignatureVerification } from '../../lib/crypto/signature';
import type { Signed } from './logic';
import { schemeOf, InvalidParams, Unsupported, type Scheme } from './signatureScheme';

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

const KEY_NAMES: Record<KeyKind['kind'], string> = { rsa: 'RSA', ec: 'ECDSA', 'ec-unsupported': 'ECDSA', ed25519: 'Ed25519', other: 'その他' };
const SCHEME_KEY: Record<Scheme['kind'], KeyKind['kind']> = { rsa: 'rsa', pss: 'rsa', ecdsa: 'ec', ed25519: 'ed25519' };

/**
 * 証明書・CSR の署名を指定した公開鍵で検証する。
 *
 * @param signed - 署名対象の元バイト列・署名・アルゴリズム。
 * @param issuerSpki - 発行者の公開鍵の SPKI（DER）。CSR では自身の公開鍵。
 * @param subtle - Web Crypto API。省略時はブラウザの実装を使う。
 * @returns 署名の一致・不正・未対応。鍵を読み込めない場合も未対応として返す（verifyWithPublicKey）。
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

  let signature: Uint8Array;
  try {
    signature = scheme.kind === 'ecdsa' ? ecdsaRaw(signed.signature, (key as Extract<KeyKind, { kind: 'ec' }>).size) : signed.signature;
  } catch {
    return { status: 'invalid', message: '署名の形式が正しくありません' };
  }
  return verifyWithPublicKey({ format: 'spki', der: issuerSpki }, importAlg, verifyAlg, signature, signed.tbs, '発行者の公開鍵', subtle);
}
