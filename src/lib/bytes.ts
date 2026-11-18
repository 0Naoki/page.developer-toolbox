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

/** 空白を除き、許容するBase64URLの記号を標準のBase64へそろえる。パディングは変更しない。 */
function normalizeBase64(input: string): string {
  return input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
}

/** 明示されたパディングは検証し、完全に省略された場合だけ補う。 */
function validatedBase64(text: string): string {
  const bad = text.search(/[^A-Za-z0-9+/=]/);
  /** 絵文字などのサロゲートペアを半分で切らないよう、1文字分（コードポイント）を表示する。 */
  if (bad >= 0) throw new Error(`Base64に使えない文字が含まれています（${String.fromCodePoint(text.codePointAt(bad)!)}）`);
  if (/=[^=]/.test(text)) throw new Error('パディング（=）は末尾にだけ書けます');
  const paddingAt = text.indexOf('=');
  if (paddingAt >= 0) {
    if (text.length - paddingAt > 2 || text.length % 4 !== 0) {
      throw new Error('Base64のパディング（=）の個数または全体の長さが不正です');
    }
    return text;
  }
  const rest = text.length % 4;
  if (rest === 1) throw new Error('Base64として長さが不正です（1文字多いか、足りません）');
  return rest ? text + '='.repeat(4 - rest) : text;
}

/**
 * Base64 / Base64URL をバイト列にデコードする。
 *
 * @remarks
 * 改行・空白、パディングの完全な省略、2つの形式の混在を許容する汎用の変換。
 * = を書く場合は1〜2個を末尾に置き、全体の長さを4の倍数にする。部分的な省略や余剰は補正しない。
 * JWS のように厳密な Base64URL が必要な用途では、呼び出し側でも形式を検証する。
 *
 * @param input - Base64 または Base64URL の文字列。
 * @returns 復号したバイト列。
 * @throws Base64 に使えない文字、不正なパディング位置や長さがある場合。
 */
export function base64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = normalizeBase64(input);
  const encoded = validatedBase64(normalized);
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}

/** バイト列を16進数にする。sep で区切り、upper なら大文字にする（証明書のシリアル番号など） */
export function toHex(bytes: Uint8Array, sep = '', upper = false): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep);
  return upper ? hex.toUpperCase() : hex;
}
