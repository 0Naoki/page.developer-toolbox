/**
 * 行の区切り（CRLF・LF・CR）。
 *
 * @remarks
 * 大きな貼り付けでは入力欄が元の改行を保つため、Windows（CRLF）・Unix（LF）・古い Mac（CR）と、その混在を
 * どれも1つの改行として扱う。CRLF を先に試し、「\r\n」を2行に分けない
 */
export const LINE_BREAK = /\r\n|\r|\n/;

/**
 * テキストを行に分ける。行番号は、返した配列の添字 + 1 が元のテキストの行に一致する。
 *
 * @param limit 返す行数の上限（巨大な入力を全行に分けずに、上限を超えたかだけを調べるとき）
 * @returns 空文字は1つの空の行（[""]）。末尾の改行の後ろも空の行として返す
 */
export function splitLines(text: string, limit?: number): string[] {
  return text.split(LINE_BREAK, limit);
}
