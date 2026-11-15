/**
 * 画面に並べる一覧の件数の上限（既定）。
 *
 * @remarks
 * 入力の上限内でも、数万件の一覧（証明書の SAN・拡張など）を作れる。全件を描画すると画面が数秒以上止まるため、
 * 先頭だけを表示し、全件はコピー・保存で取り出す（表示用のデータと全文のデータを分ける）
 */
export const LIST_PREVIEW_LIMIT = 100;

/** 一覧の先頭 limit 件と、表示しない残りの件数 */
export function previewList<T>(items: readonly T[], limit = LIST_PREVIEW_LIMIT, total = items.length): { shown: readonly T[]; rest: number } {
  return { shown: items.length > limit ? items.slice(0, limit) : items, rest: Math.max(0, total - limit) };
}
