/**
 * 計算 Worker との通信の型。要求（CalculationRequest）と、ツールごとの結果（CalculationResults）の組を定める。
 *
 * @remarks
 * 型はツールの計算処理（src/tools/<フォルダ名>/）から読む。実行時に読み込むのは handlers.ts だけで、
 * 画面・フックはこのファイルを読んでも、ツールの計算処理を読み込まない（型の import だけのため）。
 * 入力の上限などの値は src/lib/worker/calculationLimits.ts にある。
 */
import type { JsonIndent, JsonResult } from '../tools/json-formatter/logic';
import type { Newline } from '../tools/text-count/count';
import type { TextMeasurement, Measure } from '../tools/text-count/logic';
import type { CsvConversion, CsvConversionRequest } from '../tools/csv-json/calculation';
import type { DiffCalculation, DiffRequest } from '../tools/text-diff/calculation';
import type { convertEpochsInText, BulkMode } from '../tools/unix-time/epoch';
import type { aggregateList, calculateVlsm, checkOverlapList } from '../tools/subnet/listCalculation';
import type { Zone } from '../lib/time/timezone';
import type { TextConversion, TextConversionRequest } from '../tools/base64/logic';

export type CalculationRequest =
  | { tool: 'json'; input: string; indent: JsonIndent; sortKeys: boolean }
  | ({ tool: 'csv' } & CsvConversionRequest)
  | { tool: 'count'; input: string; newline: Newline; measure: Measure }
  | ({ tool: 'diff' } & DiffRequest)
  | { tool: 'epoch'; input: string; zone: Zone; mode: BulkMode }
  | ({ tool: 'base64' } & TextConversionRequest)
  | { tool: 'subnetAggregate'; input: string }
  | { tool: 'subnetOverlap'; input: string }
  | { tool: 'subnetVlsm'; input: string; network: number; prefix: number; cloud: boolean };

/** ツールごとの結果の型 */
export type CalculationResults = {
  json: JsonResult;
  count: TextMeasurement;
  csv: CsvConversion;
  diff: DiffCalculation;
  epoch: ReturnType<typeof convertEpochsInText>;
  base64: TextConversion;
  subnetAggregate: ReturnType<typeof aggregateList>;
  subnetOverlap: ReturnType<typeof checkOverlapList>;
  subnetVlsm: ReturnType<typeof calculateVlsm>;
};
export type CalculationTool = CalculationRequest['tool'];
/** ツールごとの要求（tool で絞り込んだ要求の型） */
export type CalculationRequestOf<T extends CalculationTool> = Extract<CalculationRequest, { tool: T }>;
/**
 * Worker の応答。成功のときは、どのツールの結果かを tool に持つ。
 * 受け取る側は要求の tool と一致することを確かめ、別のツールの結果を表示しない
 */
export type CalculationResponse<T extends CalculationTool = CalculationTool> =
  | { [K in T]: { ok: true; tool: K; result: CalculationResults[K] } }[T]
  | { ok: false; error: string };

/** 入力の上限と比べる大きさ（差分は2つの入力の合計） */
export const calculationInputSize = (request: CalculationRequest): number =>
  request.input.length + (request.tool === 'diff' ? request.after.length : 0);

/**
 * 要求に対する応答として受け取れるか確かめる。別のツールの結果（Worker の実装の誤りなど）は、結果として扱わずにエラーにする。
 *
 * @returns 要求のツールの結果か、エラーの応答。
 */
export function acceptResponse<T extends CalculationTool>(request: { tool: T }, response: CalculationResponse): CalculationResponse<T> {
  if (response.ok && response.tool !== request.tool) return { ok: false, error: '計算結果を受け取れませんでした。画面を再読み込みしてください。' };
  return response as CalculationResponse<T>;
}
