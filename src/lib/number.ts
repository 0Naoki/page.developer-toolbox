/**
 * 件数・文字数・バイト数などの数を、3桁ごとのカンマ区切りで書く（`12,345`）。
 *
 * @remarks
 * 書式は日本語（`ja-JP`）に固定する。ロケールを省いた `toLocaleString()` はブラウザの言語設定に従い、
 * ドイツ語なら `12.345`、フランス語なら `12 345` になって、日本語の画面の中で小数と紛らわしくなるため。
 * 数の書式は、この関数だけを通す（静的検査あり）。
 *
 * @param n - 書く数。大きな整数は bigint のまま渡す（桁を丸めない）。
 */
export function formatNumber(n: number | bigint): string {
  return n.toLocaleString('ja-JP');
}
