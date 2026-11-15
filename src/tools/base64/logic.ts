import { base64ToBytes, bytesToBase64 } from '../../lib/bytes';
import { describeAt, findLoneSurrogate, replacementWarning } from '../../lib/text/surrogate';
import { errorMessage } from '../../lib/errors';

export { findLoneSurrogate };

export type EncodeMode = 'base64' | 'base64url' | 'url';

/** デコード結果をテキストとして読むときの文字コード */
export type Charset = 'utf-8' | 'shift_jis' | 'euc-jp' | 'utf-16le';

/** UTF-8文字列をBase64にエンコードする（日本語対応） */
export function encodeBase64(text: string, urlSafe = false, wrap = false): string {
  return bytesToBase64(new TextEncoder().encode(text), { urlSafe, wrap });
}

/** Base64 / Base64URL をUTF-8文字列にデコードする（パディング省略も許容） */
export function decodeBase64(input: string): string {
  const text = bytesToText(base64ToBytes(input), 'utf-8');
  if (text === null) throw new Error('デコード結果がUTF-8のテキストではありません（バイナリの可能性）');
  return text;
}

/** バイト列を指定した文字コードのテキストとして読む。その文字コードとして不正なら null */
export function bytesToText(bytes: Uint8Array, charset: Charset): string | null {
  try {
    /** 先頭の U+FEFF も元のデータの一部なので、取り除かない（往復で元に戻らなくなる） */
    return new TextDecoder(charset, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** タブ・改行以外の制御文字（NUL など）を含む。テキストとして読めても、バイナリの可能性が高い */
export const looksBinary = (text: string) => /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text);

/** 「%E3%81%82」のようなパーセントエンコードをバイト列に戻す（% 以外の文字は UTF-8 にする） */
function percentToBytes(s: string): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      /** サロゲートペアは2つで1文字なので、まとめて変換する */
      const ch = String.fromCodePoint(s.codePointAt(i)!);
      for (const b of encoder.encode(ch)) out.push(b);
      i += ch.length - 1;
    }
  }
  return Uint8Array.from(out);
}

export type Decoded = {
  bytes: Uint8Array<ArrayBuffer>;
  /** data: URI に書かれた MIME タイプ。data: URI でなければ null */
  mime: string | null;
  /** 入力の形式（表示用） */
  variant: string;
};

/** Base64 の文字から、どちらの形式かを表す */
function variantOf(input: string): string {
  const s = input.replace(/\s+/g, '');
  const url = /[-_]/.test(s);
  const std = /[+/]/.test(s);
  const kind = url && std ? 'Base64 と Base64URL の記号が混在' : url ? 'Base64URL' : std ? 'Base64' : '記号なし（Base64・Base64URL のどちらとしても同じ）';
  const parts = [kind, s.endsWith('=') ? 'パディングあり' : s.length % 4 ? 'パディングなし' : null, /\s/.test(input.trim()) ? '改行あり' : null];
  return parts.filter(Boolean).join('・');
}

/** Base64、または data: URI（data:image/png;base64,...）をデコードする */
export function decodeInput(input: string): Decoded {
  const trimmed = input.trim();
  /** URL Standard と同じく、URL として読む前にタブ・改行を取り除く（%0A と書いた改行は、パーセント復号で残る） */
  const uri = trimmed.replace(/[\t\n\r]/g, '');
  const m = /^data:([^,#]*),/i.exec(uri);
  if (!m) return { bytes: base64ToBytes(trimmed), mime: null, variant: variantOf(trimmed) };
  /**
   * ブラウザ（Fetch Standard の data: URL の処理）と同じく、
   * 「#」以降はフラグメントとして除き、本文はパーセント復号してから使う。
   * Base64 として読むのは、MIME タイプの末尾が「;base64」のときだけ
   */
  const header = m[1] ?? '';
  const isBase64 = /;[ ]*base64[ ]*$/i.test(header);
  /** RFC 2397：MIME タイプを省略したときは text/plain;charset=US-ASCII */
  const mime = (header.split(';')[0] ?? '').trim() || 'text/plain';
  const hash = uri.indexOf('#', m[0].length);
  const data = percentToBytes(hash < 0 ? uri.slice(m[0].length) : uri.slice(m[0].length, hash));
  if (!isBase64) return { bytes: data, mime, variant: 'data: URI（パーセントエンコード）' };
  /** パーセント復号したバイトを1バイト1文字として Base64 の文字列に戻す（Base64 以外のバイトはそこでエラーになる） */
  let text = '';
  for (const b of data) text += String.fromCharCode(b);
  return { bytes: base64ToBytes(text), mime, variant: 'data: URI（Base64）' };
}

/** バイト列を data: URI にする */
export const toDataUri = (bytes: Uint8Array, mime: string) => `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;

/** 先頭のバイト（マジックナンバー）からファイルの種類を推定する */
export function sniffType(bytes: Uint8Array): { label: string; mime: string; ext: string } | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { label: 'PNG 画像', mime: 'image/png', ext: 'png' };
  if (starts([0xff, 0xd8, 0xff])) return { label: 'JPEG 画像', mime: 'image/jpeg', ext: 'jpg' };
  if (starts([0x47, 0x49, 0x46, 0x38])) return { label: 'GIF 画像', mime: 'image/gif', ext: 'gif' };
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return { label: 'WebP 画像', mime: 'image/webp', ext: 'webp' };
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { label: 'PDF', mime: 'application/pdf', ext: 'pdf' };
  if (starts([0x50, 0x4b, 0x03, 0x04])) return { label: 'ZIP（Office 文書なども含む）', mime: 'application/zip', ext: 'zip' };
  if (starts([0x1f, 0x8b])) return { label: 'gzip', mime: 'application/gzip', ext: 'gz' };
  return null;
}

/** エンコードするファイルの上限（バイト）。出力は約1.33倍の文字数になり、それを出力欄に表示するため */
export const MAX_FILE = 5 * 1024 * 1024;

/**
 * これより短いテキストは、その場で変換する（入力のたびに出力が消えないように）。
 * 長い入力は Worker で変換し、画面を止めない（4M文字のデコードは画面の処理で約0.8秒かかっていた）
 */
export const SYNC_LIMIT = 100_000;

/** 16進ダンプで表示する最大のバイト数（これより大きいと画面が重くなる） */
export const HEX_DUMP_MAX = 16 * 1024;

const hex2 = (b: number) => b.toString(16).padStart(2, '0');

/** hexdump -C と同じ形式（位置・16バイトの16進数・ASCII）の16進ダンプ。先頭 max バイトまで */
export function hexDump(bytes: Uint8Array, max = HEX_DUMP_MAX): string {
  const lines: string[] = [];
  const end = Math.min(bytes.length, max);
  for (let off = 0; off < end; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, end));
    let hex = '';
    let ascii = '';
    for (let i = 0; i < 16; i++) {
      const b = row[i];
      hex += (b === undefined ? '  ' : hex2(b)) + (i === 7 ? '  ' : ' ');
      if (b !== undefined) ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    }
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`);
  }
  return lines.join('\n');
}

export function encode(text: string, mode: EncodeMode, wrap = false): string {
  if (mode === 'url') {
    const lone = findLoneSurrogate(text);
    if (lone >= 0) throw new Error(`${describeAt(text, lone)}が対になっていないサロゲートのため、URLエンコードできません`);
    return encodeURIComponent(text);
  }
  return encodeBase64(text, mode === 'base64url', wrap);
}

/** Base64 でエンコードするときに U+FFFD（�）へ置き換わる文字の警告。なければ null */
export const surrogateWarning = (text: string): string | null => replacementWarning(text, 'エンコードしました');

export function decode(text: string, mode: EncodeMode): string {
  if (mode === 'url') {
    try {
      return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch {
      throw new Error('URLエンコードとして不正な形式です');
    }
  }
  return decodeBase64(text);
}

/** テキストの変換の結果。bytes はデコードしたバイト列（Base64・data: URI のとき） */
export type TextConversion =
  | { kind: 'empty' }
  | { kind: 'error'; error: string }
  | { kind: 'text'; output: string; warning: string | null }
  | ({ kind: 'bytes' } & Decoded);

export type TextConversionRequest = { input: string; direction: 'encode' | 'decode'; mode: EncodeMode; wrap: boolean };

/**
 * 入力欄のテキストを変換する。大きな入力では画面が止まらないよう Worker から呼ぶ。
 *
 * @remarks
 * エンコードでは空白や改行もデータとして変換する。デコードでは空白だけの入力を空とする。
 * 変換できない入力は例外にせず、kind が 'error' の結果として返す（Worker からも同じ形で受け取るため）。
 */
export function convertText({ input, direction, mode, wrap }: TextConversionRequest): TextConversion {
  try {
    if (direction === 'encode' ? input === '' : !input.trim()) return { kind: 'empty' };
    if (direction === 'encode') return { kind: 'text', output: encode(input, mode, wrap), warning: mode === 'url' ? null : surrogateWarning(input) };
    if (mode === 'url') return { kind: 'text', output: decode(input, mode), warning: null };
    return { kind: 'bytes', ...decodeInput(input) };
  } catch (e) {
    return { kind: 'error', error: errorMessage(e) };
  }
}
