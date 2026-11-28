/**
 * PEM（-----BEGIN 〜 -----END）の読み取り。証明書デコーダーと JWT の公開鍵の入力で共通に使う。
 *
 * @remarks
 * どの種類のブロックを受け付けるか、何個まで読むか、秘密鍵をどう断るかは呼び出し側が決める。
 * ここでは、BEGIN と END の組・本文の Base64 を、どちらの入力でも同じ厳しさで読むことだけを受け持つ。
 */
import { base64ToBytes } from '../bytes';
import { LINE_BREAK } from '../text/lines';

/** PEM の1つのブロック。type は BEGIN の行の種類（CERTIFICATE・PUBLIC KEY など） */
export type PemBlock = { type: string; der: Uint8Array<ArrayBuffer> };

export const PEM_UNMATCHED = '-----BEGIN と -----END の組がそろっていません';

/**
 * PEM の本文（標準の Base64）をバイト列にする。
 *
 * @remarks
 * 共通の base64ToBytes は Base64URL の - と _ も受け付けるため、先に標準の文字だけかを確かめる
 * （閉じていない BEGIN の行の「-----」を Base64 として読まないように）。空白・改行は無視する。
 *
 * @throws 標準の Base64 にない文字があるとき、または文字数が正しくないとき。
 */
export function pemBodyToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64.replace(/\s+/g, ''))) throw new Error('Base64 として読めない文字があります');
  try {
    return base64ToBytes(b64);
  } catch {
    throw new Error('Base64 として読めません（文字数が正しくありません。コピーするときに一部が欠けていないか確認してください）');
  }
}

/**
 * 文字列の中の PEM のブロックを、先頭から順にすべて読む。ブロックの外の文字（openssl の出力の subject= の行など）は読み飛ばす。
 *
 * @remarks
 * 正規表現（BEGIN ごとに END を探して末尾まで読み直す）だと、閉じていない BEGIN が多い入力で計算量が2乗になり
 * 画面が固まるため、先頭から1回だけ読み進める。
 * ヘッダー行（Proc-Type: など）は古い形式でだけ使われるので、: を含む行は読み飛ばす。
 *
 * @param options.checkType - ブロックの種類を確かめる。受け付けない種類なら例外を投げる（本文を読む前に呼ぶ）。
 * @param options.maxBlocks - 読むブロックの上限。超えたら `options.tooMany` の文言で断る（本文を読む前に断る）。
 * @returns 読んだブロック。BEGIN の行がなければ空の配列。
 * @throws BEGIN と END の組がそろっていないとき、本文が Base64 として読めないとき、checkType・上限で断ったとき。
 */
export function readPemBlocks(
  text: string,
  options: { checkType: (type: string) => void; maxBlocks: number; tooMany: string },
): PemBlock[] {
  const blocks: PemBlock[] = [];
  for (let pos = text.indexOf('-----BEGIN '); pos >= 0; pos = text.indexOf('-----BEGIN ', pos)) {
    const headEnd = text.indexOf('-----', pos + 11);
    const type = headEnd < 0 ? '' : text.slice(pos + 11, headEnd);
    if (!/^[A-Z0-9 ]+$/.test(type)) throw new Error(PEM_UNMATCHED);
    const endMarker = `-----END ${type}-----`;
    const end = text.indexOf(endMarker, headEnd + 5);
    if (end < 0) throw new Error(PEM_UNMATCHED);
    options.checkType(type);
    if (blocks.length >= options.maxBlocks) throw new Error(options.tooMany);
    const body = text
      .slice(headEnd + 5, end)
      .split(LINE_BREAK)
      .filter((l) => !l.includes(':'))
      .join('');
    blocks.push({ type, der: pemBodyToBytes(body) });
    pos = end + endMarker.length;
  }
  /** 「-----BEGIN」の後に空白がないなど、ブロックとして読めない BEGIN だけがある */
  if (blocks.length === 0 && text.includes('-----BEGIN')) throw new Error(PEM_UNMATCHED);
  return blocks;
}
