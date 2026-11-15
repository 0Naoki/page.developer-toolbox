/** バイト列と文字列（Base64・16進数）の変換。Base64 ツール・ハッシュ・証明書・JWT で共通に使う */

/** 一度に String.fromCharCode へ渡すバイト数（引数が多すぎると RangeError になるため分ける） */
const CHUNK = 0x8000;

/** バイト列を Base64 にする。wrap は MIME（RFC 2045）と同じく76文字ごとに改行する */
export function bytesToBase64(bytes: Uint8Array, o: { urlSafe?: boolean; wrap?: boolean } = {}): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  const out = btoa(parts.join(''));
  if (o.urlSafe) return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return o.wrap ? out.replace(/(.{76})(?=.)/g, '$1\n') : out;
}

/**
 * Base64 / Base64URL をバイト列にデコードする。
 *
 * @remarks
 * 改行・空白、パディング省略、2つの形式の混在を許容する汎用の変換。
 * JWS のように厳密な Base64URL が必要な用途では、呼び出し側でも形式を検証する。
 *
 * @param input - Base64 または Base64URL の文字列。
 * @returns 復号したバイト列。
 * @throws Base64 に使えない文字、不正なパディング位置や長さがある場合。
 */
export function base64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  let s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bad = s.search(/[^A-Za-z0-9+/=]/);
  /** 絵文字などのサロゲートペアを半分で切らないよう、1文字分（コードポイント）を表示する */
  if (bad >= 0) throw new Error(`Base64に使えない文字が含まれています（${String.fromCodePoint(s.codePointAt(bad)!)}）`);
  if (/=[^=]/.test(s)) throw new Error('パディング（=）は末尾にだけ書けます');
  s = s.replace(/=+$/, '');
  const rest = s.length % 4;
  if (rest === 1) throw new Error('Base64として長さが不正です（1文字多いか、足りません）');
  if (rest) s += '='.repeat(4 - rest);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** バイト列を16進数にする。sep で区切り、upper なら大文字にする（証明書のシリアル番号など） */
export function toHex(bytes: Uint8Array, sep = '', upper = false): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep);
  return upper ? hex.toUpperCase() : hex;
}
