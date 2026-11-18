import { eachLineRange } from '../../lib/text/lines';
import type { DiffLine, DiffRow } from './logic';

/** 変更のない連続行。本文を行ごとに複製せず、入力と行番号から復元する。 */
export type EqualRange = { kind: 'range'; leftNo: number; rightNo: number; count: number; from: number; blockStart?: number };
export type PackedBlock = EqualRange | DiffRow;
export type PackedRows = {
  blocks: PackedBlock[];
  before: string; after: string;
  leftStarts: Uint32Array; rightStarts: Uint32Array;
  length: number;
};

/** 行の開始位置だけを持つ。文字列・行オブジェクトを全行分作らない。 */
function lineStarts(text: string): Uint32Array {
  if (text === '') return new Uint32Array();
  let count = 0;
  eachLineRange(text, () => { count++; });
  const starts = new Uint32Array(count);
  let i = 0;
  eachLineRange(text, (start) => { starts[i++] = start; });
  return starts;
}

/**
 * 一致行が多ければ入力参照へ圧縮し、少なければ行を直接保持する。
 * @remarks UTF-16本文・行開始位置・オブジェクトの概算を比べる。実際の転送サイズは実行環境で異なる。
 * 変更行はどちらも同じなので比較から除く。変更行の強調情報と元の改行はそのまま残す。
 */
export function packRows(rows: readonly DiffRow[], before: string, after: string): PackedRows {
  const blocks: PackedBlock[] = [];
  let hasEqual = false;
  let literalCost = 0;
  let rangeCost = 2 * (before.length + after.length);
  let leftLines = 0;
  let rightLines = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.left) leftLines = row.left.no;
    if (row.right) rightLines = row.right.no;
    if (row.kind === 'change') { blocks.push(row); continue; }
    hasEqual = true;
    literalCost += 80 + 2 * (row.left.text.length + row.right.text.length);
    const last = blocks.at(-1);
    if (last?.kind === 'range') last.count++;
    else {
      blocks.push({ kind: 'range', leftNo: row.left.no, rightNo: row.right.no, count: 1, from: i });
      rangeCost += 72;
    }
  }
  rangeCost += 4 * (leftLines + rightLines);
  if (hasEqual && literalCost < rangeCost) {
    return { blocks: [...rows], before: '', after: '', length: rows.length, leftStarts: new Uint32Array(), rightStarts: new Uint32Array() };
  }
  return {
    blocks, before: hasEqual ? before : '', after: hasEqual ? after : '', length: rows.length,
    leftStarts: hasEqual ? lineStarts(before) : new Uint32Array(), rightStarts: hasEqual ? lineStarts(after) : new Uint32Array(),
  };
}

/**
 * 入力の1行を読む。CR・LF・CRLF と末尾の空行を元の差分と同じ規則で扱う。
 * no は差分が返した行番号なので、開始位置の配列の範囲内にある。
 */
function lineAt(text: string, starts: Uint32Array, no: number): DiffLine {
  const start = starts[no - 1]!;
  const next = starts[no];
  let end = next ?? text.length;
  const crlf = next !== undefined && text.charCodeAt(end - 2) === 13 && text.charCodeAt(end - 1) === 10;
  if (next !== undefined) end -= crlf ? 2 : 1;
  const line = { no, text: text.slice(start, end) };
  return crlf ? { ...line, crlf: true } : line;
}

/** 範囲内の1行だけを復元する。表示する行以外のオブジェクトは作らない。 */
export function equalRowAt(rows: PackedRows, range: EqualRange, offset: number): Extract<DiffRow, { kind: 'equal' }> {
  if (range.blockStart !== undefined) return rows.blocks[range.blockStart + offset] as Extract<DiffRow, { kind: 'equal' }>;
  return {
    kind: 'equal',
    left: lineAt(rows.before, rows.leftStarts, range.leftNo + offset),
    right: lineAt(rows.after, rows.rightStarts, range.rightNo + offset),
  };
}
