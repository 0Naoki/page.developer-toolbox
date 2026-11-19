import { countText, type CountOptions, type CountResult } from './count';
import { eucjpBytesOf, isHalfWidth, sjisBytesOf } from './encoding';
import { inspectInvisible, type InvisibleInspection } from './invisible';
import { eachLineRange } from '../../lib/text/lines';

export type Measure = 'sjis' | 'eucjp' | 'utf8' | 'utf16' | 'chars' | 'width';

export const MEASURES: { value: Measure; label: string; hint: string }[] = [
  { value: 'sjis', label: 'Shift_JISバイト', hint: 'SQL Server の varchar（日本語照合順序）、Shift_JIS の固定長ファイル' },
  { value: 'eucjp', label: 'EUC-JPバイト', hint: 'EUC-JP の固定長ファイルや古い UNIX 系のシステム（補助漢字は3バイト）' },
  { value: 'utf8', label: 'UTF-8バイト', hint: 'Oracle の VARCHAR2(n BYTE)（AL32UTF8）、PostgreSQL の octet_length' },
  { value: 'utf16', label: 'UTF-16バイト', hint: 'SQL Server の nvarchar（1文字2バイト、サロゲートペアは4バイト）、Windows の API' },
  { value: 'chars', label: '文字数', hint: 'MySQL の VARCHAR(n)、PostgreSQL の varchar(n)、Oracle の n CHAR' },
  { value: 'width', label: '桁数（全角=2）', hint: '帳票や画面の表示幅（半角=1、全角=2）' },
];

export type LineStat = { no: number; text: string; value: number; over: boolean };

export const LINE_PAGE_SIZE = 100;
const LINE_PREVIEW_SIZE = 1000;

export type TextAnalysis = {
  counts: CountResult;
  invisible: InvisibleInspection;
  issueTotals: { unsupported: number; unsupportedEuc: number; vendor: number };
  visible: (LineStat & { truncated: boolean; segments?: Segment[] })[];
  matchingLines: number;
  overCount: number;
};

/**
 * 入力と計測方法ごとに1回だけ求める集計。
 *
 * @remarks
 * 全文の走査はここだけで行う。ページの切り替えや上限の変更では作り直さず、{@link linesPage} で表示分を切り出す。
 * 行の位置は元の入力の UTF-16 の位置で、改行（CR・LF・CRLF）を含まない。
 */
export type TextMeasurement = {
  counts: CountResult;
  invisible: InvisibleInspection;
  issueTotals: TextAnalysis['issueTotals'];
  measure: Measure;
  /** 行ごとの計測値 */
  values: Float64Array;
  starts: Uint32Array;
  ends: Uint32Array;
};

/** 全文の文字数と不可視文字を集計し、行ごとの計測値と位置を求める。 */
export function measureText(input: string, options: CountOptions & { measure: Measure }): TextMeasurement {
  const counts = countText(input, options);
  const issueTotals = counts.issueTotals;
  const starts: number[] = [];
  const ends: number[] = [];
  if (input !== '') {
    eachLineRange(input, (start, end) => {
      starts.push(start);
      ends.push(end);
    });
  }
  const values = Float64Array.from(starts, (s, i) => measureOf(input.slice(s, ends[i]), options.measure));
  return { counts, invisible: inspectInvisible(input), issueTotals, measure: options.measure, values, starts: Uint32Array.from(starts), ends: Uint32Array.from(ends) };
}

/**
 * 集計済みの行から、画面に出す1ページ分を切り出す。
 *
 * @remarks
 * 行ごとの計測値を見るだけなので、全文の再計測はしない。input は {@link measureText} に渡したものと同じにする。
 */
export function linesPage(
  input: string,
  m: TextMeasurement,
  options: PageOptions,
): Pick<TextAnalysis, 'visible' | 'matchingLines' | 'overCount'> {
  const visible: TextAnalysis['visible'] = [];
  const start = Math.max(0, options.page) * LINE_PAGE_SIZE;
  let matchingLines = 0;
  let overCount = 0;
  for (let i = 0; i < m.values.length; i++) {
    /** i は values の範囲内（数十万行を走査するため、反復子を使わずに添字で読む） */
    const value = m.values[i] ?? 0;
    const over = options.limit !== null && value > options.limit;
    if (over) overCount++;
    if (options.onlyOver && options.limit !== null && !over) continue;
    const position = matchingLines++;
    if (position < start || visible.length >= LINE_PAGE_SIZE) continue;
    const original = input.slice(m.starts[i], m.ends[i]);
    /** Array.from は長い1行を丸ごと配列にするので、先頭の表示分だけ走査する。 */
    let text = '';
    for (const ch of original) {
      if (text.length + ch.length > LINE_PREVIEW_SIZE) break;
      text += ch;
    }
    const segments = m.measure === 'sjis' || m.measure === 'eucjp' ? splitByEncodable(text, m.measure) : undefined;
    visible.push({ no: i + 1, value, over, text, truncated: text.length < original.length, segments });
  }
  return { visible, matchingLines, overCount };
}

/** 1ページ分の表示の指定（行の上限・超過行だけにするか・ページ番号） */
export type PageOptions = { limit: number | null; onlyOver: boolean; page: number };

/**
 * 集計の結果（{@link measureText}）に、画面に出す1ページ分の行（{@link linesPage}）を合わせる。
 *
 * @remarks
 * 画面は、全文の集計を Worker で行い、ページや上限を変えたときはこの関数で切り出し直すだけにする。
 * input は measureText に渡したものと同じにする。
 */
export function analysisOf(input: string, m: TextMeasurement, options: PageOptions): TextAnalysis {
  return { counts: m.counts, invisible: m.invisible, issueTotals: m.issueTotals, ...linesPage(input, m, options) };
}

export function measureOf(text: string, measure: Measure): number {
  if (measure === 'utf8') return new TextEncoder().encode(text).length;
  if (measure === 'utf16') return text.length * 2;
  let value = 0;
  for (const ch of text) {
    if (measure === 'chars') value++;
    else if (measure === 'sjis') value += sjisBytesOf(ch) ?? 2;
    else if (measure === 'eucjp') value += eucjpBytesOf(ch) ?? 2;
    else value += isHalfWidth(ch) ? 1 : 2;
  }
  return value;
}

export type Segment = { text: string; bad: boolean };

/** 行を、表現できない文字とそれ以外に分ける（表示で強調するため）。連続する部分はまとめる */
export function splitByEncodable(text: string, charset: 'sjis' | 'eucjp'): Segment[] {
  const out: Segment[] = [];
  for (const ch of text) {
    const bad = (charset === 'sjis' ? sjisBytesOf(ch) : eucjpBytesOf(ch)) === null;
    const last = out[out.length - 1];
    if (last && last.bad === bad) last.text += ch;
    else out.push({ text: ch, bad });
  }
  return out;
}
