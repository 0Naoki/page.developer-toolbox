import { readName, sameBytes, sameName, type ParsedName } from './name';
import { type DerItem } from './pem';
import { oidName, readExtensions, type ExtensionSummary } from './extensions';
import { errorMessage } from '../../lib/errors';
import { curveInfo } from '../../lib/crypto/curves';
import {
  assertTag,
  isContext,
  isUniversal,
  parseDer,
  parseDerExact,
  rawOf,
  readBitString,
  readInteger,
  SMALL_INTEGER_BYTES,
  readOid,
  readTime,
  TAG,
  toUpperHex,
  valueOf,
  type Node,
} from '../../lib/crypto/asn1';

/**
 * X.509 証明書と CSR（証明書署名要求）の解析。
 * 表示に必要な項目だけを読む。署名の検証は verify.ts で行う。失効の確認（OCSP・CRL。通信が必要）は行わない。
 */

/** RSA の公開指数の長さの上限（通常は 65537 の3バイト。表示するだけなので、4096ビットの鍵と同じ長さまで読む） */
const MAX_EXPONENT_BYTES = 512;

/** 名前の対応表 */

const SIGNATURE_ALGORITHMS: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'MD5 + RSA（危険）',
  '1.2.840.113549.1.1.5': 'SHA-1 + RSA（非推奨）',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.113549.1.1.11': 'SHA-256 + RSA',
  '1.2.840.113549.1.1.12': 'SHA-384 + RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 + RSA',
  '1.2.840.10045.4.1': 'ECDSA + SHA-1（非推奨）',
  '1.2.840.10045.4.3.2': 'ECDSA + SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA + SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA + SHA-512',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
};

/** 共通の部品 */

export type PublicKeyInfo = { algorithm: string; bits: number | null; detail: string };

function bitLength(v: Uint8Array): number {
  let i = 0;
  while (i < v.length && v[i] === 0) i++;
  const first = v[i];
  if (first === undefined) return 0;
  return (v.length - i - 1) * 8 + (32 - Math.clz32(first));
}

function readPublicKey(spki: Node): PublicKeyInfo {
  const alg = assertTag(spki.children[0], TAG.SEQUENCE, '公開鍵のアルゴリズム');
  const oid = readOid(assertTag(alg.children[0], TAG.OID, '公開鍵のアルゴリズム'));
  const key = readBitString(assertTag(spki.children[1], TAG.BIT_STRING, '公開鍵'));
  switch (oid) {
    case '1.2.840.113549.1.1.1': {
      const rsa = parseDer(key.bytes);
      const modulus = valueOf(assertTag(rsa.children[0], TAG.INTEGER, 'RSA の公開鍵'));
      const exponent = readInteger(assertTag(rsa.children[1], TAG.INTEGER, 'RSA の公開鍵'), MAX_EXPONENT_BYTES);
      const bits = bitLength(modulus);
      return { algorithm: 'RSA', bits, detail: `RSA ${bits}ビット（公開指数 ${exponent}）` };
    }
    case '1.2.840.10045.2.1': {
      const param = alg.children[1];
      const curveOid = isUniversal(param, TAG.OID) ? readOid(param) : '';
      const curve = curveInfo(curveOid);
      return curve
        ? { algorithm: 'ECDSA', bits: curve.bits, detail: `ECDSA ${curve.name}（${curve.bits}ビット）` }
        : { algorithm: 'ECDSA', bits: null, detail: `ECDSA（曲線 ${curveOid || '不明'}）` };
    }
    case '1.3.101.112':
      return { algorithm: 'Ed25519', bits: 256, detail: 'Ed25519' };
    case '1.3.101.113':
      return { algorithm: 'Ed448', bits: 456, detail: 'Ed448' };
    case '1.2.840.10040.4.1': {
      const p = alg.children[1]?.children[0];
      const bits = isUniversal(p, TAG.INTEGER) ? bitLength(valueOf(p)) : null;
      return { algorithm: 'DSA', bits, detail: `DSA${bits ? ` ${bits}ビット` : ''}（非推奨）` };
    }
    default:
      return { algorithm: oid, bits: null, detail: `不明なアルゴリズム（${oid}）` };
  }
}

function readAlgorithm(n: Node | undefined): string {
  const seq = assertTag(n, TAG.SEQUENCE, '署名アルゴリズム');
  return oidName(SIGNATURE_ALGORITHMS, readOid(assertTag(seq.children[0], TAG.OID, '署名アルゴリズム')));
}

/** 証明書と CSR */

/** 署名の検証に使う部品。証明書も CSR も「本体・署名アルゴリズム・署名」の3つが並ぶ */
export type Signed = {
  /** 署名の対象（本体の DER） */
  tbs: Uint8Array;
  /** 署名アルゴリズム（AlgorithmIdentifier） */
  algorithm: Node;
  signature: Uint8Array;
  /** 自分の公開鍵（SubjectPublicKeyInfo の DER） */
  spki: Uint8Array;
  /** 署名の検証の前に無効とわかる形式の問題。中身の表示はできるので、読み込みのエラーにはしない */
  malformed?: string;
};

/** innerAlgorithm は証明書の本体の中の署名アルゴリズム（CSR にはない） */
function signedOf(root: Node, spki: Node, innerAlgorithm?: Node): Signed {
  const algorithm = assertTag(root.children[1], TAG.SEQUENCE, '署名アルゴリズム');
  const { bytes, unused } = readBitString(assertTag(root.children[2], TAG.BIT_STRING, '署名'));
  const signed: Signed = { tbs: rawOf(assertTag(root.children[0], TAG.SEQUENCE, '署名対象')), algorithm, signature: bytes, spki: rawOf(spki) };
  if (unused !== 0) signed.malformed = '署名の BIT STRING の未使用ビット数が0ではありません';
  /** RFC 5280 4.1.1.2：本体の中と外側の署名アルゴリズムは同じでなければならない */
  else if (innerAlgorithm && !sameBytes(rawOf(innerAlgorithm), rawOf(algorithm))) signed.malformed = '証明書の本体の中と外側で、署名アルゴリズムが異なります';
  return signed;
}

export type Certificate = {
  kind: 'certificate';
  der: Uint8Array;
  signed: Signed;
  version: number;
  serial: string;
  signatureAlgorithm: string;
  issuer: ParsedName;
  subject: ParsedName;
  notBefore: Date;
  notAfter: Date;
  publicKey: PublicKeyInfo;
  /**
   * 自己発行（ルート証明書など）。発行者とサブジェクトが同じで、鍵識別子（AKI と SKI）が異ならないもの。
   * 署名を自分の鍵で検証できるか（自己署名か）は、この値では判定しない
   * 名前が同じでも鍵識別子が異なる証明書（CA の鍵の更新で、古い鍵で新しい鍵に署名したもの）は含めない
   */
  selfIssued: boolean;
} & ExtensionSummary;

export type Csr = {
  kind: 'csr';
  der: Uint8Array;
  signed: Signed;
  subject: ParsedName;
  publicKey: PublicKeyInfo;
  signatureAlgorithm: string;
  /** 表示しない属性（challengePassword などのパスワード） */
  hiddenAttributes: string[];
} & ExtensionSummary;

export function parseCertificate(der: Uint8Array): Certificate {
  const root = parseDerExact(der);
  const tbs = assertTag(root.children[0], TAG.SEQUENCE, '証明書の本体');
  let i = 0;
  let version = 1;
  const versionNode = tbs.children[0];
  if (isContext(versionNode, 0)) {
    version = Number(readInteger(assertTag(versionNode.children[0], TAG.INTEGER, 'バージョン'), SMALL_INTEGER_BYTES)) + 1;
    i++;
  }
  const serialNode = assertTag(tbs.children[i++], TAG.INTEGER, 'シリアル番号');
  let serialBytes = valueOf(serialNode);
  if (serialBytes.length > 1 && serialBytes[0] === 0) serialBytes = serialBytes.subarray(1); /** 正の数にするための先頭の0 */
  const innerAlgorithm = assertTag(tbs.children[i++], TAG.SEQUENCE, '署名アルゴリズム');
  const issuer = readName(tbs.children[i++]);
  const validity = assertTag(tbs.children[i++], TAG.SEQUENCE, '有効期間');
  const subject = readName(tbs.children[i++]);
  const spki = assertTag(tbs.children[i++], TAG.SEQUENCE, '公開鍵');
  const publicKey = readPublicKey(spki);
  const extWrapper = tbs.children.slice(i).find((c) => isContext(c, 3));
  const extensions = readExtensions(extWrapper?.children[0]);
  const time = (n: Node | undefined) => {
    if (!isUniversal(n, TAG.UTC_TIME) && !isUniversal(n, TAG.GENERALIZED_TIME)) throw new Error('有効期間を読めません');
    return readTime(n);
  };

  return {
    kind: 'certificate',
    der,
    signed: signedOf(root, spki, innerAlgorithm),
    version,
    serial: toUpperHex(serialBytes, ':'),
    signatureAlgorithm: readAlgorithm(root.children[1]),
    issuer,
    subject,
    notBefore: time(validity.children[0]),
    notAfter: time(validity.children[1]),
    publicKey,
    selfIssued:
      sameName(issuer, subject) &&
      !(extensions.authorityKeyId && extensions.subjectKeyId && extensions.authorityKeyId !== extensions.subjectKeyId),
    ...extensions,
  };
}

export function parseCsr(der: Uint8Array): Csr {
  const root = parseDerExact(der);
  const info = assertTag(root.children[0], TAG.SEQUENCE, 'CSR の本体');
  assertTag(info.children[0], TAG.INTEGER, 'CSR のバージョン');
  const subject = readName(info.children[1]);
  const spki = assertTag(info.children[2], TAG.SEQUENCE, '公開鍵');
  const publicKey = readPublicKey(spki);
  const attributes = info.children[3];
  let extensions: Node | undefined;
  const hiddenAttributes: string[] = [];
  for (const attr of isContext(attributes, 0) ? attributes.children : []) {
    const oid = readOid(assertTag(attr.children[0], TAG.OID, '属性の種類'));
    if (oid === '1.2.840.113549.1.9.14') extensions = attr.children[1]?.children[0];
    if (oid === '1.2.840.113549.1.9.7') hiddenAttributes.push('challengePassword（パスワードのため表示しません）');
  }
  return {
    kind: 'csr',
    der,
    signed: signedOf(root, spki),
    subject,
    publicKey,
    signatureAlgorithm: readAlgorithm(root.children[1]),
    hiddenAttributes,
    ...readExtensions(extensions),
  };
}

/** PEM の種類から証明書か CSR かを決める。種類が分からなければ（DER・Base64）証明書として読み、だめなら CSR として読む */
export function parseItem(item: DerItem): Certificate | Csr {
  const isCsr = item.type.includes('REQUEST');
  try {
    return isCsr ? parseCsr(item.der) : parseCertificate(item.der);
  } catch (e) {
    if (item.type === 'DER' || item.type === 'BASE64') {
      try {
        return parseCsr(item.der);
      } catch {
        /** 証明書として読んだときのエラーを出す */
      }
    }
    throw new Error(`${isCsr ? 'CSR' : '証明書'}として読めません：${errorMessage(e)}`);
  }
}
