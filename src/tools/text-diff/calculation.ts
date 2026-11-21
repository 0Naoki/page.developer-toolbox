import { diffText, type DiffOptions, type DiffResult, type DiffRow } from './logic';
import { toUnified } from './unified';
import { equalRowAt, packRows, type PackedRows } from './packed';

/** 計算 Worker で差分を求めるときの要求。input が変更前、after が変更後 */
export type DiffRequest = DiffOptions & { input: string; after: string };

/** 画面用の差分。コピー用の全文は含めず、利用者が準備を選んだときだけ別のWorker要求で作る。 */
export type DiffCalculation = Omit<DiffResult, 'rows'> & { rows: PackedRows };

/** 表示に必要な差分だけを求める（計算 Worker から呼ぶ）。 */
export function calculateDiff(request: DiffRequest): DiffCalculation {
  const result = diffText(request.input, request.after, request);
  return { ...result, rows: packRows(result.rows, request.input, request.after) };
}

/** 表示した差分を全文パッチにする。探索をやり直さないため、打ち切られた差分も表示と同じ行の対応を保つ。 */
export function unifiedFromPacked(packed: PackedRows): string {
  const rows: DiffRow[] = [];
  for (const block of packed.blocks) {
    if (block.kind !== 'range') rows.push(block);
    else for (let i = 0; i < block.count; i++) rows.push(equalRowAt(packed, block, i));
  }
  return toUnified({ rows });
}
