/**
 * JWT の検証に使う鍵の読み込み。
 * HMAC の秘密鍵（共通鍵）には、公開鍵・秘密鍵（PEM・JWK・DER）の形の入力を受け付けない（アルゴリズムの取り違えを防ぐ）。
 * 公開鍵は PEM・証明書・JWK・JWK Set から読み、秘密鍵を含む入力は拒否する。鍵を取得するための外部通信や保存は行わない。
 */
import { base64ToBytes } from '../../lib/bytes';
import { isRecord } from '../../lib/settings';
import { describeAt, findLoneSurrogate } from '../../lib/text/surrogate';
import { TAG, isUniversal, parseDerExact } from '../../lib/crypto/asn1';
import { containsPrivateKey, isPrivateKeyDer } from '../../lib/crypto/privateKey';
import { keyKindOf } from '../../lib/crypto/spki';
import { certificatePublicKey } from '../../lib/crypto/x509';
import { readPemBlocks } from '../../lib/crypto/pem';
import { detailPreview } from '../../lib/text/textPreview';
import { algSpec, isHmacAlg, neededKey, type AlgSpec, type KeyType } from './alg';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/number';

export type SecretEncoding = 'utf-8' | 'base64';

/** HMAC の秘密鍵の文字列をバイト列にする */
export function secretBytes(secret: string, encoding: SecretEncoding): Uint8Array<ArrayBuffer> {
  rejectKeyFormats(secret);
  if (encoding === 'utf-8') {
    /** U+FFFD に置き換えると、入力と違う鍵で検証して「署名は正しい」と表示してしまう */
    const lone = findLoneSurrogate(secret);
    if (lone >= 0) throw new Error(`秘密鍵の${describeAt(secret, lone)}が対になっていないサロゲートのため、UTF-8 にできません`);
    return new TextEncoder().encode(secret);
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64ToBytes(secret);
  } catch (e) {
    throw new Error(`秘密鍵を Base64 として読めません：${errorMessage(e)}`);
  }
  rejectDecodedKeyFormats(bytes);
  return bytes;
}

/** HMAC の秘密鍵が、RFC 7518 3.2 の求める長さ（ハッシュと同じ長さ）より短ければ警告する */
export function shortSecretWarning(alg: unknown, bytes: Uint8Array): string | null {
  if (!isHmacAlg(alg)) return null;
  const need = Number((alg as string).slice(2)) / 8;
  return bytes.length < need
    ? `秘密鍵が ${bytes.length} バイトで、${alg as string} に必要な ${need} バイト（RFC 7518）より短いです。総当たりで見つけられるおそれがあります`
    : null;
}

/** 公開鍵の読み込み */

export type PublicKey =
  | { format: 'spki'; der: Uint8Array<ArrayBuffer>; source: string }
  | { format: 'jwk'; jwk: Record<string, unknown>; source: string };

/** 公開鍵の入力の上限（UTF-16 の単位。証明書チェーンを貼っても足りる大きさ） */
export const MAX_KEY = 64 * 1024;

const FORMATS = '対応している形式は、PEM の公開鍵（BEGIN PUBLIC KEY）と証明書（BEGIN CERTIFICATE）、JWK・JWK Set（JSON）です';

/** JWK の秘密の値（RFC 7518 6.2.2・6.3.2・6.4） */
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];
const hasPrivateMember = (jwk: Record<string, unknown>) => PRIVATE_MEMBERS.some((m) => m in jwk);

const OCT_JWK = 'kty が oct の鍵（共通鍵）は、HS256 などのトークンの「秘密鍵」の欄に、k の値を Base64 として入力してください';

/** 鍵の選択前に入力全体へ適用する。選択されない鍵の秘密の値も見逃さない。 */
function rejectPrivateJwk(jwk: unknown): void {
  if (!isRecord(jwk)) return;
  if (jwk.kty === 'oct') throw new Error(OCT_JWK);
  if (hasPrivateMember(jwk)) throw new Error('JWK に秘密鍵の値（d など）が含まれています。検証には公開鍵だけを使います（秘密鍵は貼り付けないでください。解析も保存もしていません）');
}

function checkJwk(jwk: unknown): Record<string, unknown> {
  if (!isRecord(jwk)) throw new Error('JWK は JSON のオブジェクトで指定してください');
  rejectPrivateJwk(jwk);
  /** 検証では文字列の alg・use だけを確かめ、Web Crypto API にはこれらを取り除いて渡すため、型が違う指定はここで断る（RFC 7517 4.2〜4.4） */
  for (const name of ['alg', 'use'] as const) {
    if (name in jwk && typeof jwk[name] !== 'string') throw new Error(`JWK の ${name} が文字列ではありません（${detailPreview(JSON.stringify(jwk[name]))}）`);
  }
  if ('key_ops' in jwk) {
    const ops = jwk.key_ops;
    if (!Array.isArray(ops) || !ops.every((op) => typeof op === 'string') || new Set(ops).size !== ops.length) {
      throw new Error(`JWK の key_ops は、重複のない文字列の配列で指定してください（${detailPreview(JSON.stringify(ops) ?? String(ops))}）`);
    }
  }
  return jwk;
}

/** 文字列が JWK・JWK Set なら、含まれる鍵を返す（kty を持たない JSON や、JSON でない文字列は鍵として扱わない） */
function jwksIn(text: string): Record<string, unknown>[] {
  if (!text.startsWith('{')) return [];
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const list: unknown[] = isRecord(json) && Array.isArray(json.keys) ? json.keys : [json];
  return list.filter((k): k is Record<string, unknown> => isRecord(k) && 'kty' in k);
}

/** HMAC の鍵の欄に貼られた PEM・JWK を、検証に使わず断る（公開鍵なら偽のトークンを正しいと判定するおそれがある） */
function rejectKeyFormats(secret: string): void {
  const text = secret.trim();
  const pem = text.includes('-----BEGIN');
  const jwks = jwksIn(text);
  if (!pem && jwks.length === 0) return;
  if (jwks.some((k) => k.kty === 'oct')) throw new Error(OCT_JWK);
  if (pem ? containsPrivateKey(text) : jwks.some(hasPrivateMember)) throw new Error(PRIVATE_KEY_AS_SECRET);
  throw new Error(PUBLIC_KEY_AS_SECRET);
}

const PRIVATE_KEY_AS_SECRET = '秘密鍵が含まれています。HS256 などの検証には、発行元と共有した共通鍵だけを使います（公開鍵暗号の秘密鍵は貼り付けないでください。解析も保存もしていません）';
const PUBLIC_KEY_AS_SECRET = '公開鍵を HMAC の鍵にすると、その公開鍵で作った偽のトークンを正しいと判定するため、検証しません。発行元が RS256 などを使っているなら、alg が書き換えられています';

/**
 * Base64 から戻した鍵も、PEM・JWK の文字列や DER の鍵・証明書なら断る（公開鍵を Base64 で包んだ入力や、PEM の本文だけの入力）。
 * DER は、全体がちょうど1つの SEQUENCE になっているかだけを見る。共通鍵の乱数がたまたまこの形になることは、実質的にない
 */
function rejectDecodedKeyFormats(bytes: Uint8Array): void {
  let text: string | null = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    /** テキストでない鍵 */
  }
  if (text !== null) rejectKeyFormats(text);
  try {
    if (!isUniversal(parseDerExact(bytes), TAG.SEQUENCE)) return;
  } catch {
    return;
  }
  throw new Error(isPrivateKeyDer(bytes) ? PRIVATE_KEY_AS_SECRET : PUBLIC_KEY_AS_SECRET);
}

/** 鍵がトークンの alg で使えるか（鍵の種類・曲線と、指定があれば use・alg）。alg を読めなければ絞り込まない */
function fitsAlg(jwk: unknown, alg: unknown): boolean {
  let spec: AlgSpec;
  try {
    spec = algSpec(alg);
  } catch {
    return true;
  }
  if (!isRecord(jwk) || spec.family === 'hmac') return true;
  if ((typeof jwk.use === 'string' && jwk.use !== 'sig') || (typeof jwk.alg === 'string' && jwk.alg !== alg)) return false;
  try {
    return keyTypeOf({ format: 'jwk', jwk, source: '' }) === neededKey(spec);
  } catch {
    return false;
  }
}

/**
 * JWK Set から、トークンの kid と alg に合う鍵を選ぶ。種類の違う鍵が同じ kid を使うことがあるため（RFC 7517 4.5）、
 * 並び順で最初の鍵を選ばず、alg に合う鍵で絞る。決められなければ、署名の不一致とは別のエラーにする
 */
function pickFromSet(keys: unknown[], kid: unknown, alg: unknown): { jwk: unknown; source: string } {
  if (keys.length === 0) throw new Error('JWK Set に鍵がありません');
  const byKid = typeof kid === 'string' ? keys.filter((k) => isRecord(k) && k.kid === kid) : keys;
  if (typeof kid === 'string' && byKid.length === 0) throw new Error(`トークンの kid「${detailPreview(kid)}」に一致する鍵が、JWK Set にありません`);
  /** 1つしかなければ、合わなくても選ぶ（検証で、鍵の種類や alg が合わないことを理由とともに伝える） */
  const candidates = byKid.length === 1 ? byKid : byKid.filter((k) => fitsAlg(k, alg));
  /** kid・alg・証明書の名前はトークンや鍵に由来し、長さに制限がないため、文言には抜粋を入れる */
  const what = typeof kid === 'string' ? `kid「${detailPreview(kid)}」` : 'kid がないトークン';
  if (candidates.length === 0) throw new Error(`JWK Set に、${what}と alg（${detailPreview(String(alg))}）に合う鍵がありません`);
  if (candidates.length > 1) throw new Error(`JWK Set に、${what}と alg（${detailPreview(String(alg))}）に合う鍵が複数あるため、どの鍵で検証するか決められません`);
  return { jwk: candidates[0], source: typeof kid === 'string' ? `JWK Set の kid「${detailPreview(kid)}」の鍵` : 'JWK Set の鍵' };
}

const PKCS1_PUBLIC_KEY = 'PKCS#1 形式（BEGIN RSA PUBLIC KEY）には対応していません。openssl rsa -RSAPublicKey_in -pubout で BEGIN PUBLIC KEY の形式に変換してください';

/**
 * PEM の公開鍵か証明書を1つだけ読む。
 * 証明書のチェーンなど複数のブロックから1つを黙って選ぶと、署名した鍵と違う鍵で検証して「一致しない」と表示するため、複数なら断る
 */
function readPemKey(text: string): PublicKey {
  const [block] = readPemBlocks(text, {
    checkType: (type) => {
      if (type === 'RSA PUBLIC KEY') throw new Error(PKCS1_PUBLIC_KEY);
      if (type !== 'PUBLIC KEY' && type !== 'CERTIFICATE') throw new Error(`「${detailPreview(type)}」には対応していません。${FORMATS}`);
    },
    maxBlocks: 1,
    tooMany: 'PEM のブロックが複数あります。検証に使う公開鍵か証明書を1つだけ入力してください（証明書のチェーンなら、トークンに署名した鍵の証明書だけ）',
  });
  /** -----BEGIN を含む入力は、ブロックがなければ readPemBlocks が組のそろわない入力として断るため、ここには来ない */
  if (!block) throw new Error(FORMATS);
  if (block.type === 'PUBLIC KEY') return { format: 'spki', der: block.der, source: '公開鍵（PEM）' };
  let key: ReturnType<typeof certificatePublicKey>;
  try {
    key = certificatePublicKey(block.der);
  } catch (e) {
    throw new Error(`証明書を読めません（${errorMessage(e)}）`);
  }
  return { format: 'spki', der: new Uint8Array(key.spki), source: key.commonName === null ? '証明書の公開鍵' : `証明書「${detailPreview(key.commonName)}」の公開鍵` };
}

/**
 * 公開鍵（PEM・証明書・JWK・JWK Set）を読み込む。
 *
 * @remarks
 * 秘密鍵を含む入力は拒否する。鍵を取得するための外部通信や保存は行わない。
 * JWK Set の候補が複数ある場合は、一意に選べる場合だけ受け付ける。
 *
 * @param input - 公開鍵または証明書の文字列。
 * @param kid - トークンの鍵識別子。JWK Set の選択に使う。
 * @param alg - トークンの署名アルゴリズム。JWK Set の候補を絞るために使う。
 * @returns 検証に渡す公開鍵と読み込み元の説明。
 * @throws 入力が上限超過・不正・秘密鍵を含む場合、または鍵を一意に選べない場合。
 */
export function readPublicKey(input: string, kid?: unknown, alg?: unknown): PublicKey {
  const text = input.trim();
  if (text.length > MAX_KEY) throw new Error(`公開鍵が大きすぎます（${formatNumber(MAX_KEY)}文字まで）`);
  if (containsPrivateKey(text)) {
    throw new Error('秘密鍵が含まれています。検証には公開鍵だけを使います（秘密鍵は貼り付けないでください。解析も保存もしていません）');
  }
  if (text.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('JWK として読めません（JSON の形式が正しくありません）');
    }
    const keys = (json as { keys?: unknown }).keys;
    if (Array.isArray(keys)) {
      for (const key of keys) rejectPrivateJwk(key);
      const picked = pickFromSet(keys, kid, alg);
      return { format: 'jwk', jwk: checkJwk(picked.jwk), source: picked.source };
    }
    return { format: 'jwk', jwk: checkJwk(json), source: '公開鍵（JWK）' };
  }
  if (text.includes('-----BEGIN')) return readPemKey(text);
  throw new Error(FORMATS);
}

/** 鍵の種類（RSA・曲線の名前など）。読めなければ例外 */
export function keyTypeOf(key: PublicKey): KeyType {
  if (key.format === 'jwk') {
    const { kty, crv } = key.jwk;
    if (kty === 'RSA') return 'RSA';
    if ((kty === 'EC' || kty === 'OKP') && typeof crv === 'string') return crv;
    return `kty: ${String(kty)}`;
  }
  let kind;
  try {
    kind = keyKindOf(key.der);
  } catch {
    throw new Error('公開鍵の中身（SubjectPublicKeyInfo）を読めません');
  }
  if (kind.kind === 'rsa') return 'RSA';
  if (kind.kind === 'ec') return kind.curve;
  if (kind.kind === 'ec-unsupported') return kind.curve;
  if (kind.kind === 'ed25519') return 'Ed25519';
  return 'その他';
}
