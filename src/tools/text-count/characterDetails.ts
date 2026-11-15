export const codePointOf = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** 一覧（文字の種類・出現位置）に並べる件数の上限。多すぎると、計算の後の転送と描画で画面が止まる */
export const MAX_LISTED = 100;
