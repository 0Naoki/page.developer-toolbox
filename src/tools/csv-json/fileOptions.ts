import type { Delimiter } from './csvFormat';

export type Direction = 'csv2json' | 'json2csv';

/** ファイルの拡張子から変換設定を選ぶ。.txt は方向だけ変え、未知の拡張子では現在の設定を保つ。 */
export function optionsForFile(name: string, current: { direction: Direction; delimiter: Delimiter }): { direction: Direction; delimiter: Delimiter } {
  const extension = /\.(json|csv|tsv|txt)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension === 'json') return { ...current, direction: 'json2csv' };
  if (extension === 'csv') return { direction: 'csv2json', delimiter: ',' };
  if (extension === 'tsv') return { direction: 'csv2json', delimiter: '\t' };
  if (extension === 'txt') return { ...current, direction: 'csv2json' };
  return current;
}
