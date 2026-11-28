import { toUpperHex } from '../../lib/crypto/asn1';

/** 証明書の DER のフィンガープリント（SHA-256・SHA-1。コロン区切りの大文字の16進数） */
export async function fingerprints(der: Uint8Array): Promise<{ sha256: string; sha1: string }> {
  const bytes = new Uint8Array(der) as Uint8Array<ArrayBuffer>;
  /** ハッシュ生成ツールに依存しないよう、Web Crypto API を直接使う（SHA の2種類だけなので MD5 の実装は不要） */
  const digest = async (alg: string) => new Uint8Array(await crypto.subtle.digest(alg, bytes));
  const [sha256, sha1] = await Promise.all([digest('SHA-256'), digest('SHA-1')]);
  return { sha256: toUpperHex(sha256, ':'), sha1: toUpperHex(sha1, ':') };
}
