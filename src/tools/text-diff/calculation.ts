import { diffText, type DiffOptions, type DiffResult } from './logic';
import { toUnified } from './unified';

/** 計算 Worker で差分を求めるときの要求。input が変更前、after が変更後 */
export type DiffRequest = DiffOptions & { input: string; after: string };

/** 画面に返す差分の結果。unified はコピー用のテキストで、全行を走査するため画面側で描画のたびに作らない */
export type DiffCalculation = DiffResult & { unified: string };

/** 差分と、コピー用の unified 形式をまとめて求める（計算 Worker から呼ぶ） */
export function calculateDiff(request: DiffRequest): DiffCalculation {
  const result = diffText(request.input, request.after, request);
  return { ...result, unified: toUnified(result) };
}
