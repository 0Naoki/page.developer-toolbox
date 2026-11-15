/**
 * 対になっていないサロゲート（\\uD800 だけ、など）の位置を返す。なければ -1。
 * UTF-8 では表せないため、TextEncoder は U+FFFD（�）に置き換え、encodeURIComponent は例外を投げる
 */
export function findLoneSurrogate(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
      else return i;
    } else if (c >= 0xdc00 && c <= 0xdfff) return i;
  }
  return -1;
}

/** 位置を「n 文字目（U+XXXX）」の形で表す */
export const describeAt = (text: string, i: number) =>
  `${i + 1} 文字目（U+${text.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}）`;

/**
 * テキストを UTF-8 にするときに U+FFFD（�）へ置き換わる文字の警告。なければ null。
 *
 * @param done - 置き換えた後に行った処理（「エンコードしました」「計算しました」など）。文の末尾に入る
 */
export function replacementWarning(text: string, done: string): string | null {
  const lone = findLoneSurrogate(text);
  return lone < 0 ? null : `${describeAt(text, lone)}などの対になっていないサロゲートは、UTF-8 で表せないため U+FFFD（�）に置き換えて${done}`;
}
