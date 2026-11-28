import { csvToJson, isEmptyConversionInput, type CsvToJsonOptions } from './logic';
import { jsonToCsv, type JsonToCsvOptions } from './writeCsv';
import { formatNumber } from '../../lib/number';
import type { Direction } from './csvFormat';

/** 計算 Worker で変換するときの要求。両方向の設定を持ち、変換の方向（direction）で使う側を選ぶ */
export type CsvConversionRequest = {
  input: string;
  direction: Direction;
  csvOptions: CsvToJsonOptions;
  jsonOptions: JsonToCsvOptions;
};

/** 画面に返す変換の結果。方向によらず同じ形にし、出力・要約（行数×列数）・警告だけを持つ */
export type CsvConversion = { output: string; summary: string; warnings: string[] };

/**
 * 要求の方向に変換し、画面に返す形にする（計算 Worker から呼ぶ）。
 *
 * @throws 入力を変換できないとき（構文の誤り・上限の超過など）。文言はそのまま画面に表示する。
 */
export function convertCsvRequest(request: CsvConversionRequest): CsvConversion {
  if (isEmptyConversionInput(request.input, request.direction)) return { output: '', summary: '', warnings: [] };
  const result = request.direction === 'csv2json'
    ? csvToJson(request.input, request.csvOptions)
    : jsonToCsv(request.input, request.jsonOptions);
  return {
    output: 'json' in result ? result.json : result.csv,
    summary: `${formatNumber(result.rows)}行 × ${formatNumber(result.columns)}列`,
    warnings: 'warnings' in result ? result.warnings : [],
  };
}
