export const codePointOf = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** 一覧（文字の種類・出現位置）に並べる件数の上限。多すぎると、計算の後の転送と描画で画面が止まる */
export const MAX_LISTED = 100;

/** 多種類の文字でフォントの探索・配置が長くならないよう、通常の入力表示を抑える。 */
export const COUNT_INPUT_PREVIEW = 2000;
/** フォント探索が重くなりやすい、多種類の補助平面文字を含む場合の入力表示上限。 */
export const DIVERSE_INPUT_PREVIEW = 500;
/** 先頭の通常表示範囲に、この種類数を超える補助平面文字があれば短い表示へ切り替える。 */
const DIVERSE_GLYPHS = 128;
/** 全文の走査を増やさず、通常表示する先頭範囲だけで文字の多様さを確認する。 */
export function countInputPreviewLimit(text: string): number {
  const supplementary = new Set<number>();
  let offset = 0;
  while (offset < text.length && offset < COUNT_INPUT_PREVIEW) {
    const cp = text.codePointAt(offset)!;
    offset += cp > 0xffff ? 2 : 1;
    if (cp > 0xffff) supplementary.add(cp);
    if (supplementary.size > DIVERSE_GLYPHS) return DIVERSE_INPUT_PREVIEW;
  }
  return COUNT_INPUT_PREVIEW;
}
/** コードポイントなどの詳細は100種類のまま、文字の形だけを通常は先頭分に限る。 */
export const ISSUE_GLYPH_PREVIEW = 5;
