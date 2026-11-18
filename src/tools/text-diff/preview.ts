import { equalRowAt, type EqualRange, type PackedRows } from './packed';
import type { FoldedRow, UnifiedDisplayRow } from './rows';

type SelectedBlock = EqualRange | { kind: 'fold'; count: number; from: number } | { kind: 'changes'; start: number; end: number };
type PreviewOptions = { onlyChanges: boolean; context: number; expanded: readonly number[]; limit: number };

/**
 * 範囲の折りたたみと展開。全行を配列に戻さず、変更の区間ごとに選ぶ。
 * blocks の添字はループの条件と start・end で範囲内に限り、行ごとの存在確認は省く。
 */
function* selectedBlocks(rows: PackedRows, options: PreviewOptions): Generator<SelectedBlock> {
  const expanded = new Set(options.expanded);
  let from = 0;
  for (let i = 0; i < rows.blocks.length; i++) {
    const block = rows.blocks[i]!;
    if (block.kind === 'change') {
      const start = i;
      while (rows.blocks[i + 1]?.kind === 'change') i++;
      yield { kind: 'changes', start, end: i + 1 };
      from += i + 1 - start;
      continue;
    }
    let range: EqualRange;
    if (block.kind === 'equal') {
      const start = i;
      while (rows.blocks[i + 1]?.kind === 'equal') i++;
      range = { kind: 'range', leftNo: block.left.no, rightNo: block.right.no, count: i + 1 - start, from, blockStart: start };
    } else range = block;
    from += range.count;
    const head = range.from === 0 ? 0 : options.context;
    const tail = range.from + range.count === rows.length ? 0 : options.context;
    if (!options.onlyChanges || range.count <= head + tail + 1) { yield range; continue; }
    if (head) yield { ...range, count: head };
    const count = range.count - head - tail;
    const foldedFrom = range.from + head;
    if (expanded.has(foldedFrom)) yield sliceRange(range, head, count);
    else yield { kind: 'fold', count, from: foldedFrom };
    if (tail) yield sliceRange(range, range.count - tail, tail);
  }
}

/** 直接保持・入力参照のどちらも、折りたたみで同じ行を指す。 */
function sliceRange(range: EqualRange, offset: number, count: number): EqualRange {
  return { ...range, from: range.from + offset, leftNo: range.leftNo + offset, rightNo: range.rightNo + offset, count,
    ...(range.blockStart !== undefined ? { blockStart: range.blockStart + offset } : {}) };
}

/** 左右表示の先頭 limit 行と全件数。展開しても、表示上限の外の行は復元しない。 */
export function splitPreview(rows: PackedRows, options: PreviewOptions): { shown: FoldedRow[]; total: number } {
  const shown: FoldedRow[] = [];
  let total = 0;
  for (const block of selectedBlocks(rows, options)) {
    if (block.kind === 'range') {
      total += block.count;
      const count = Math.min(block.count, Math.max(0, options.limit - shown.length));
      for (let i = 0; i < count; i++) shown.push(equalRowAt(rows, block, i));
    } else if (block.kind === 'changes') {
      total += block.end - block.start;
      for (let i = block.start; i < block.end && shown.length < options.limit; i++) {
        const row = rows.blocks[i]!;
        if (row.kind === 'change') shown.push(row);
      }
    } else {
      total++;
      if (shown.length < options.limit) shown.push(block);
    }
  }
  return { shown, total };
}

/** 統合表示の先頭 limit 行と全件数。連続する変更は削除を先、追加を後に並べる。 */
export function unifiedPreview(rows: PackedRows, options: PreviewOptions): { shown: UnifiedDisplayRow[]; total: number } {
  const shown: UnifiedDisplayRow[] = [];
  let total = 0;
  for (const block of selectedBlocks(rows, options)) {
    if (block.kind === 'range') {
      total += block.count;
      const count = Math.min(block.count, Math.max(0, options.limit - shown.length));
      for (let i = 0; i < count; i++) {
        const row = equalRowAt(rows, block, i);
        shown.push({ kind: 'equal', line: row.left, aNo: row.left.no, bNo: row.right.no });
      }
    } else if (block.kind === 'changes') {
      for (const side of ['left', 'right'] as const) {
        for (let i = block.start; i < block.end; i++) {
          const row = rows.blocks[i]!;
          const line = row.kind === 'change' ? row[side] : undefined;
          if (!line) continue;
          total++;
          if (shown.length < options.limit) shown.push(side === 'left' ? { kind: 'del', line, aNo: line.no } : { kind: 'add', line, bNo: line.no });
        }
      }
    } else {
      total++;
      if (shown.length < options.limit) shown.push(block);
    }
  }
  return { shown, total };
}
