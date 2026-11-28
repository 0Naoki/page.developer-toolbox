import { oneOf } from '../../lib/settings';
import { formatNumber } from '../../lib/number';

/** 変換の方向 */
export type Direction = 'csv2json' | 'json2csv';

export type Delimiter = ',' | '\t' | ';' | '|';
export const isDelimiter = oneOf<Delimiter>(',', '\t', ';', '|');

export const MAX_CSV_CELLS = 2_000_000;
export const MAX_CSV_OUTPUT = 32_000_000;

export function checkCells(cells: number): void {
  if (cells > MAX_CSV_CELLS) throw new Error(`展開後のセル数が多すぎます（${formatNumber(MAX_CSV_CELLS)}セルまで）。列や行を分けて変換してください。`);
}

/**
 * 行の最大の列数。Math.max(...rows.map(...)) は引数の数に上限があり、
 * 十万行規模で RangeError になるため、ループで求める。
 */
export function maxColumns(rows: readonly (readonly unknown[])[], initial = 0): number {
  let max = initial;
  for (const r of rows) if (r.length > max) max = r.length;
  return max;
}
