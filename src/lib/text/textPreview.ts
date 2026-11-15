/** 長いテキストの表示の抜粋。全文は計算・コピー・保存に使い、画面に出す量だけを制限する。 */
import { formatNumber } from '../number';
/** 入力・整形結果の通常表示の上限（UTF-16コード単位）。全文データの上限とは分ける。 */
export const TEXT_PREVIEW_LIMIT = 50_000;
/** 画面の案内に使う上限の表記 */
export const TEXT_PREVIEW_LIMIT_LABEL = formatNumber(TEXT_PREVIEW_LIMIT);

/** 表示だけを制限する。サロゲートペアの途中では切らない。元データは変更しない。 */
export function textPreview(text: string, limit: number): string {
  let end = limit;
  const last = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
  return text.slice(0, end);
}

/** エラーや診断に埋め込む入力の抜粋の上限（UTF-16コード単位。末尾の「…」を含む） */
export const DETAIL_PREVIEW_LIMIT = 256;

/**
 * エラーや診断に入力を埋め込むときの抜粋。上限を超えたら先頭だけにして「…」を付ける。
 * 入力欄はプレビューで表示を制限しているため、エラーの文言から長い入力を全文描画しない。
 */
export function detailPreview(text: string, limit = DETAIL_PREVIEW_LIMIT): string {
  return text.length > limit ? textPreview(text, limit - 1) + '…' : text;
}

/**
 * エラー・警告の表示に描画する文言1件の上限（UTF-16コード単位。末尾の「…」を含む）。
 *
 * @remarks
 * エラーや警告の文言には入力（キー名・アドレス・トークンの値など）が入ることがある。入力欄はプレビューで表示を制限しているため、
 * 長い入力を全文描画しないよう、文言を作る側の抜粋（{@link detailPreview}）に加えて、表示の部品（`ErrorText`・`ErrorBox`・`Notice`）の側でも上限をかける。
 */
export const MESSAGE_LIMIT = 1_000;

/** エラー・警告の表示に描画する文言。上限を超えたら先頭だけにして「…」を付ける */
export const limitMessage = (message: string): string => detailPreview(message, MESSAGE_LIMIT);

/**
 * 表の1マスや一覧の1項目に表示する、1つの値の長さの上限（UTF-16コード単位）。
 * 超えた値は ClippedText で先頭だけを表示し、省略したことを示して全文をコピーできるようにする
 */
export const VALUE_PREVIEW_LIMIT = 2_000;
