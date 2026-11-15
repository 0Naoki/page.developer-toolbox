/**
 * 差分の結果を画面に並べる行（変更のない行の折りたたみと、統合表示の並べ替え）。
 */
import type { DiffLine, DiffRow } from './logic';

export type FoldedRow = DiffRow | { kind: 'fold'; count: number; from: number };

/**
 * 配列の範囲を out の末尾に足す。push(...配列) は要素を引数に展開するため、数十万件で RangeError になる。
 */
function appendRange<T>(out: T[], items: readonly T[], from = 0, to = items.length): void {
  for (let i = from; i < to; i++) out.push(items[i]!);
}

/** 変更のない行が続く部分を、前後 context 行だけ残して折りたたむ */
export function foldRows(rows: DiffRow[], context: number): FoldedRow[] {
  const out: FoldedRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind !== 'equal') {
      out.push(row);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j]!.kind === 'equal') j++;
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === rows.length ? 0 : context;
    if (j - i > keepHead + keepTail + 1) {
      appendRange(out, rows, i, i + keepHead);
      out.push({ kind: 'fold', count: j - i - keepHead - keepTail, from: i + keepHead });
      appendRange(out, rows, j - keepTail, j);
    } else {
      appendRange(out, rows, i, j);
    }
    i = j;
  }
  return out;
}


/**
 * 画面に並べる行。変更だけを表示するときは、変更のない行を折りたたみ、利用者が開いた箇所（expanded の from）だけを戻す。
 *
 * @param expanded - 開いた折りたたみの先頭の行の位置（foldRows が返す from）。
 */
export function visibleRows(rows: DiffRow[], options: { onlyChanges: boolean; context: number; expanded: readonly number[] }): FoldedRow[] {
  if (!options.onlyChanges) return rows;
  return foldRows(rows, options.context).flatMap((row) =>
    row.kind === 'fold' && options.expanded.includes(row.from) ? rows.slice(row.from, row.from + row.count) : [row],
  );
}

/**
 * 統合表示（左右に分けない表示）の1行。unified.ts の UnifiedItem（コピー用のパッチの行）とは別のもので、
 * 折りたたみと、左右の行番号を持つ。
 */
export type UnifiedDisplayRow =
  | { kind: 'fold'; count: number; from: number }
  | { kind: 'equal' | 'del' | 'add'; line: DiffLine; aNo?: number; bNo?: number };

/** 統合表示の行にする。連続する変更は「削除した行をすべて → 追加した行をすべて」の順に並べ直す */
export function unifiedDisplayRows(rows: readonly FoldedRow[]): UnifiedDisplayRow[] {
  const out: UnifiedDisplayRow[] = [];
  const deleted: UnifiedDisplayRow[] = [];
  const added: UnifiedDisplayRow[] = [];
  const flushChanges = () => {
    appendRange(out, deleted);
    appendRange(out, added);
    deleted.length = 0;
    added.length = 0;
  };
  for (const row of rows) {
    if (row.kind === 'change') {
      if (row.left) deleted.push({ kind: 'del', line: row.left, aNo: row.left.no });
      if (row.right) added.push({ kind: 'add', line: row.right, bNo: row.right.no });
      continue;
    }
    flushChanges();
    out.push(row.kind === 'fold' ? row : { kind: 'equal', line: row.left, aNo: row.left.no, bNo: row.right.no });
  }
  flushChanges();
  return out;
}
