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

/**
 * i の文字で行が終わるか（{@link LINE_BREAK} と同じ規則。CRLF は LF の位置で終わるとみなし、CR の位置では終わらない）。
 * 行の文字列を作らずに、位置から行番号を数えるとき（エラーの位置など）に使う。
 */
export function endsLineAt(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  return c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10);
}

/**
 * 行ごとに、行の範囲（UTF-16 の位置）と、行の終わりの改行の長さを渡す（{@link splitLines} と同じ行。空文字は1つの空の行）。
 *
 * @remarks
 * 行の文字列や配列を作らないため、数百万行の入力でも使える。行の内容は text.slice(start, end)。
 * breakLength は、行の終わりの改行の長さ（CRLF は 2、LF・CR は 1、最後の行は 0）。
 *
 * @param visit - 行ごとに呼ぶ関数。false を返すと、そこで止める。
 */
export function eachLineRange(text: string, visit: (start: number, end: number, breakLength: 0 | 1 | 2) => void | false): void {
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== 10 && c !== 13) continue;
    const breakLength = c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    if (visit(start, i, breakLength) === false) return;
    i += breakLength - 1;
    start = i + 1;
  }
  visit(start, text.length, 0);
}
