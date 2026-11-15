import { splitLines } from '../../lib/text/lines';
import { diffSequencesWithStatus, type DiffLimit } from './myers';

export type Segment = { text: string; changed: boolean };
/** crlf は、元の行の終わりが CRLF だったか（unified 形式で元の改行を出すため。比較と表示には使わない） */
export type DiffLine = { no: number; text: string; segments?: Segment[]; crlf?: boolean };
export type DiffRow =
  | { kind: 'equal'; left: DiffLine; right: DiffLine }
  | { kind: 'change'; left?: DiffLine; right?: DiffLine };

export type DiffOptions = {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
};

export type DiffResult = {
  rows: DiffRow[];
  added: number;
  removed: number;
  identical: boolean;
  /** 差分が大きく、時間内に最短の手順を求めきれなかった */
  approximate: boolean;
};

/** Worker の計算の上限（CALCULATION_TIMEOUT）までに結果を返せるよう、行の差分計算はこの時間で打ち切る */
export const DIFF_TIMEOUT_MS = 2000;

/** 差分の行。共通の行の分割（splitLines。CRLF・LF・CR）と違い、空のテキストは行なし（[]）とする */
export const diffLines = (text: string) => (text === '' ? [] : splitLines(text));

/**
 * diffLines と同じ行ごとに、行の終わりが CRLF かどうか。
 * 比較は改行の違いを無視するが、unified 形式は CRLF のファイルにも適用できるよう、元の改行で出力するため
 */
export function crlfFlags(text: string): boolean[] {
  if (text === '') return [];
  const flags: boolean[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      const crlf = text.charCodeAt(i + 1) === 10;
      flags.push(crlf);
      if (crlf) i++;
    } else if (c === 10) flags.push(false);
  }
  /** 最後の行（改行で終わらない、または改行の後ろの空の行）には改行がない */
  flags.push(false);
  return flags;
}

function normalize(line: string, o: DiffOptions): string {
  let s = line;
  if (o.ignoreWhitespace) s = s.trim().replace(/\s+/g, ' ');
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}

/** 文字単位の差分（行内のどこが変わったかの強調表示用） */
export function diffChars(a: string, b: string, limit: DiffLimit = {}): { left: Segment[]; right: Segment[] } {
  const ac = Array.from(a);
  const bc = Array.from(b);
  const wholeLine = { left: [{ text: a, changed: true }], right: [{ text: b, changed: true }] };
  /** 長すぎる行は計算量が大きいので、行全体を変更扱いにする */
  if (ac.length * bc.length > 4_000_000) return wholeLine;
  const { ops, timedOut } = diffSequencesWithStatus(ac, bc, limit);
  /** 打ち切った結果は最短ではなく強調が読みにくいため、行全体を変更扱いにする */
  if (timedOut) return wholeLine;
  const left: Segment[] = [];
  const right: Segment[] = [];
  const push = (list: Segment[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const op of ops) {
    if (op.type === 'equal') {
      /** 編集手順の位置は、どれも文字の配列の範囲内 */
      push(left, ac[op.a]!, false);
      push(right, bc[op.b]!, false);
    } else if (op.type === 'delete') push(left, ac[op.a]!, true);
    else push(right, bc[op.b]!, true);
  }
  return { left, right };
}

/** 2つのテキストを行単位で比較し、左右に並べられる形で返す */
export function diffText(before: string, after: string, o: DiffOptions): DiffResult {
  const a = diffLines(before);
  const b = diffLines(after);
  const aCrlf = crlfFlags(before);
  const bCrlf = crlfFlags(after);
  /** CRLF の行にだけ crlf を付ける（LF のテキストでは結果の形を変えない） */
  const lineOf = (lines: string[], flags: boolean[], i: number): DiffLine => {
    const text = lines[i] ?? '';
    return flags[i] ? { no: i + 1, text, crlf: true } : { no: i + 1, text };
  };
  /** 行単位の比較と、変更行の中の文字単位の比較を合わせて、この時刻までに終える */
  const deadline = performance.now() + DIFF_TIMEOUT_MS;
  const { ops, timedOut } = diffSequencesWithStatus(
    a.map((l) => normalize(l, o)),
    b.map((l) => normalize(l, o)),
    { timeoutMs: DIFF_TIMEOUT_MS },
  );

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let dels: number[] = [];
  let ins: number[] = [];

  /** 連続する削除・追加をまとめて、1行ずつ左右に対応づける */
  const flush = () => {
    const count = Math.max(dels.length, ins.length);
    for (let i = 0; i < count; i++) {
      const ai = dels[i];
      const bi = ins[i];
      const left: DiffLine | undefined = ai === undefined ? undefined : lineOf(a, aCrlf, ai);
      const right: DiffLine | undefined = bi === undefined ? undefined : lineOf(b, bCrlf, bi);
      /** 時間を使い切ったら、残りの行は文字単位の強調をしない（行の差分そのものは正しい） */
      const remaining = deadline - performance.now();
      if (left && right && remaining > 0) {
        const segs = diffChars(left.text, right.text, { timeoutMs: remaining });
        /** 半分以上が共通する「似た行」のときだけ文字単位で強調する（無関係な行同士だと読みにくいため） */
        const common = segs.left.filter((x) => !x.changed).reduce((n, x) => n + Array.from(x.text).length, 0);
        const total = Array.from(left.text).length + Array.from(right.text).length;
        if (total > 0 && (common * 2) / total >= 0.5) {
          left.segments = segs.left;
          right.segments = segs.right;
        }
      }
      rows.push({ kind: 'change', left, right });
    }
    removed += dels.length;
    added += ins.length;
    dels = [];
    ins = [];
  };

  for (const op of ops) {
    if (op.type === 'delete') dels.push(op.a);
    else if (op.type === 'insert') ins.push(op.b);
    else {
      flush();
      rows.push({ kind: 'equal', left: lineOf(a, aCrlf, op.a), right: lineOf(b, bCrlf, op.b) });
    }
  }
  flush();

  return { rows, added, removed, identical: added === 0 && removed === 0, approximate: timedOut };
}
