import type { Delimiter, Direction } from './csvFormat';

/**
 * 入れ替え（出力を入力に移して向きを反転する）の後の変換方向と、移る先の向きの設定に使う区切り文字。
 * 出力は元の向きで選んだ区切り文字で書かれている（JSON→CSV）か、その区切り文字で読んだ結果（CSV→JSON）なので、
 * 移る先の向きにも同じ区切り文字を使う（タブ区切りで書いた CSV を、カンマ区切りとして1列に読まないように）。
 */
export function optionsForSwap(direction: Direction, delimiters: Record<Direction, Delimiter>): { direction: Direction; delimiter: Delimiter } {
  return direction === 'csv2json'
    ? { direction: 'json2csv', delimiter: delimiters.csv2json }
    : { direction: 'csv2json', delimiter: delimiters.json2csv };
}

/** ファイルの拡張子から変換設定を選ぶ。.txt は方向だけ変え、未知の拡張子では現在の設定を保つ。 */
export function optionsForFile(name: string, current: { direction: Direction; delimiter: Delimiter }): { direction: Direction; delimiter: Delimiter } {
  const extension = /\.(json|csv|tsv|txt)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension === 'json') return { ...current, direction: 'json2csv' };
  if (extension === 'csv') return { direction: 'csv2json', delimiter: ',' };
  if (extension === 'tsv') return { direction: 'csv2json', delimiter: '\t' };
  if (extension === 'txt') return { ...current, direction: 'csv2json' };
  return current;
}
