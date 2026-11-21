/**
 * 差分のパッチの生成（unified 形式）。比較・画面の表示とは分け、元の行と改行（CRLF）の情報からコピー用のテキストを作る
 */
import type { DiffLine, DiffResult } from './logic';

type UnifiedItem = { mark: ' ' | '-' | '+'; text: string; a?: DiffLine; b?: DiffLine };

const NO_NEWLINE = '\\ No newline at end of file';

/** 変更の前後に残す共通行の数（git diff の既定と同じ） */
const CONTEXT = 3;

/**
 * unified diff 形式のテキストを作る（コピー用）。
 * patch や git apply で使えるよう、見出し（---/+++）と、前後 CONTEXT 行だけを残したハンク（\@\@ -l,s +l,s \@\@）にする。
 * 空白・大文字小文字を無視したときに一致した行は、変更前の行を共通行として出す
 */
export function toUnified(result: Pick<DiffResult, 'rows'>): string {
  const context = CONTEXT;
  const rows = result.rows;
  let aCount = 0;
  let bCount = 0;
  for (const r of rows) {
    if (r.left) aCount = Math.max(aCount, r.left.no);
    if (r.right) bCount = Math.max(bCount, r.right.no);
  }
  /** diffLines は末尾の改行の後ろを空の行として返す。最後の行が空なら、それは「末尾に改行がある」印で、実際の行ではない */
  const aLast = rows.find((r) => r.left?.no === aCount)?.left;
  const bLast = rows.find((r) => r.right?.no === bCount)?.right;
  const aEndsNl = aLast?.text === '';
  const bEndsNl = bLast?.text === '';
  const isPhantomA = (l?: DiffLine) => aEndsNl && l?.no === aCount;
  const isPhantomB = (l?: DiffLine) => bEndsNl && l?.no === bCount;
  /** 末尾に改行がない最後の行（直後に「\\ No newline at end of file」を付ける） */
  const lacksNlA = (l?: DiffLine) => !aEndsNl && l !== undefined && l.no === aCount;
  const lacksNlB = (l?: DiffLine) => !bEndsNl && l !== undefined && l.no === bCount;

  /** 連続する変更は、削除をすべて並べてから追加を並べる */
  const items: UnifiedItem[] = [];
  const pushChange = (dels: DiffLine[], adds: DiffLine[]) => {
    for (const a of dels) items.push({ mark: '-', text: a.text, a });
    for (const b of adds) items.push({ mark: '+', text: b.text, b });
  };
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  for (const r of rows) {
    const a = isPhantomA(r.left) ? undefined : r.left;
    const b = isPhantomB(r.right) ? undefined : r.right;
    /** 末尾の改行の有無だけが違う行も、変更として出す */
    if (r.kind === 'equal' && a && b && lacksNlA(a) === lacksNlB(b)) {
      pushChange(dels, adds);
      dels = [];
      adds = [];
      items.push({ mark: ' ', text: a.text, a, b });
      continue;
    }
    if (a) dels.push(a);
    if (b) adds.push(b);
  }
  pushChange(dels, adds);

  /** 各行の前にある変更前・変更後の行数（ハンクの開始行に使う） */
  const aBefore: number[] = [];
  const bBefore: number[] = [];
  let aSeen = 0;
  let bSeen = 0;
  for (const it of items) {
    aBefore.push(aSeen);
    bBefore.push(bSeen);
    if (it.mark !== '+') aSeen++;
    if (it.mark !== '-') bSeen++;
  }

  const changed: number[] = [];
  items.forEach((it, i) => it.mark !== ' ' && changed.push(i));
  if (changed.length === 0) return '';

  const range = (start: number, count: number) => `${count === 0 ? start : start + 1}${count === 1 ? '' : `,${count}`}`;
  const out = ['--- before', '+++ after'];
  for (let c = 0; c < changed.length; ) {
    /** 変更の間の共通行が 2×context 行以下なら、同じハンクにまとめる */
    let last = c;
    /** c・last は changed の範囲内、from は items の範囲内（! はそれを示すだけ） */
    while (last + 1 < changed.length && changed[last + 1]! - changed[last]! - 1 <= context * 2) last++;
    const from = Math.max(0, changed[c]! - context);
    const to = Math.min(items.length, changed[last]! + context + 1);
    const hunk = items.slice(from, to);
    const aLen = hunk.filter((it) => it.mark !== '+').length;
    const bLen = hunk.filter((it) => it.mark !== '-').length;
    out.push(`@@ -${range(aBefore[from]!, aLen)} +${range(bBefore[from]!, bLen)} @@`);
    for (const it of hunk) {
      /** 元の行が CRLF なら、行の内容に CR を付ける（CRLF のファイルに git apply・patch で適用できるように） */
      const line = it.mark === '+' ? it.b : it.a;
      out.push(it.mark + it.text + (line?.crlf ? '\r' : ''));
      if (it.mark === '+' ? lacksNlB(it.b) : lacksNlA(it.a)) out.push(NO_NEWLINE);
    }
    c = last + 1;
  }
  return `${out.join('\n')}\n`;
}
