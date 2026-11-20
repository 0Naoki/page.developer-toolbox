import { describeAt, findLoneSurrogate, replacementWarning } from '../../lib/text/surrogate';

export const ALGORITHMS =['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

/** Web Crypto API が対応していないため MD5 は自前実装。改ざん検知などの安全性が必要な用途には使わないこと */
export const WEAK_ALGORITHMS: readonly Algorithm[] = ['MD5', 'SHA-1'];

type Bytes = Uint8Array<ArrayBuffer>;

export const utf8 = (text: string): Bytes => new TextEncoder().encode(text) as Bytes;

/** テキストを UTF-8 にするときに U+FFFD（�）へ置き換わる文字の警告。なければ null */
export const surrogateWarning = (text: string): string | null => replacementWarning(text, '計算しました');

/** HMAC の秘密鍵を UTF-8 にする。置き換えると別の鍵で計算することになるため、対になっていないサロゲートはエラーにする */
export function hmacKeyBytes(key: string): Bytes {
  const lone = findLoneSurrogate(key);
  if (lone >= 0) throw new Error(`秘密鍵の${describeAt(key, lone)}が対になっていないサロゲートのため、UTF-8 にできません`);
  return utf8(key);
}

export async function digest(algorithm: Algorithm, data: Bytes): Promise<Bytes> {
  if (algorithm === 'MD5') return md5(data);
  return new Uint8Array(await crypto.subtle.digest(algorithm, data));
}

/** ハッシュを計算するファイルの上限（バイト） */
export const MAX_FILE = 256 * 1024 * 1024;

/** MD5 を分けて処理する大きさ（バイト）。そのたびに画面へ制御を返す */
export const MD5_CHUNK = 4 * 1024 * 1024;

/**
 * MD5 を大きなデータでも画面を止めずに計算する。
 * 4 MiB（MD5_CHUNK）ずつ処理し、そのたびにブラウザへ制御を返す（その間に描画や操作ができる）。
 */
export async function md5Chunked(
  data: Uint8Array,
  onProgress?: (ratio: number) => void,
  isCancelled?: () => boolean,
): Promise<Bytes | null> {
  const h = new Md5();
  for (let off = 0; off < data.length; off += MD5_CHUNK) {
    h.update(data.subarray(off, off + MD5_CHUNK));
    onProgress?.(Math.min(1, (off + MD5_CHUNK) / data.length));
    await new Promise((r) => setTimeout(r, 0));
    if (isCancelled?.()) return null;
  }
  return h.digest();
}

/** HMAC（SHA系のみ） */
export async function hmac(algorithm: Exclude<Algorithm, 'MD5'>, key: Bytes, data: Bytes): Promise<Bytes> {
  /** Web Crypto API は長さ0の鍵を受け付けない（英語の例外になる）ので先に確認する */
  if (key.length === 0) throw new Error('HMAC の秘密鍵を入力してください');
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

/** 照合用：空白・大文字小文字・区切り文字（:）を無視して比較する */
export function sameHash(expected: string, actualHex: string, actualBase64: string): boolean {
  const e = expected.trim();
  if (!e) return false;
  const hex = e.replace(/[\s:]/g, '').toLowerCase();
  return hex === actualHex || e === actualBase64;
}

/** MD5 (RFC 1321) */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11,
  16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const rotl = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) >>> 0;

/** 逐次計算できる MD5。update を何回かに分けて呼んでも、一度に渡したときと同じ結果になる */
export class Md5 {
  private a = 0x67452301;
  private b = 0xefcdab89;
  private c = 0x98badcfe;
  private d = 0x10325476;
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  private total = 0;
  private readonly M = new Uint32Array(16);

  update(data: Uint8Array): this {
    let off = 0;
    this.total += data.length;
    /** 前回の残りがあれば、まず64バイトまで埋める */
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, data.length);
      this.block.set(data.subarray(0, take), this.blockLen);
      this.blockLen += take;
      off = take;
      if (this.blockLen < 64) return this;
      this.compress(this.block, 0);
      this.blockLen = 0;
    }
    /** 64バイト単位はコピーせずにそのまま処理する */
    for (; off + 64 <= data.length; off += 64) this.compress(data, off);
    this.block.set(data.subarray(off), 0);
    this.blockLen = data.length - off;
    return this;
  }

  digest(): Bytes {
    const bits = this.total * 8;
    const padLen = this.blockLen < 56 ? 56 - this.blockLen : 120 - this.blockLen;
    const tail = new Uint8Array(padLen + 8);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(padLen, bits >>> 0, true);
    view.setUint32(padLen + 4, Math.floor(bits / 2 ** 32), true);
    this.total -= tail.length; /** パディングは長さに数えない */
    this.update(tail);
    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    [this.a, this.b, this.c, this.d].forEach((v, i) => outView.setUint32(i * 4, v, true));
    return out;
  }

  private compress(data: Uint8Array, off: number) {
    const M = this.M;
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4;
      /** p は 64 バイトのブロックの範囲内（?? 0 は型のためだけ） */
      M[i] = ((data[p] ?? 0) | ((data[p + 1] ?? 0) << 8) | ((data[p + 2] ?? 0) << 16) | ((data[p + 3] ?? 0) << 24)) >>> 0;
    }
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      /** i は 0〜63、g は 0〜15 で、表の範囲内（?? 0 は型のためだけ） */
      f = ((f >>> 0) + a + (K[i] ?? 0) + (M[g] ?? 0)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, S[i] ?? 0)) >>> 0;
    }
    this.a = (this.a + a) >>> 0;
    this.b = (this.b + b) >>> 0;
    this.c = (this.c + c) >>> 0;
    this.d = (this.d + d) >>> 0;
  }
}

export const md5 = (data: Uint8Array): Bytes => new Md5().update(data).digest();
