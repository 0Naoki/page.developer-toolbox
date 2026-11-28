import { eucjpBytesOf, sjisBytesOf, utf8Length } from './encoding';
import { IssueList, issueReasonOf, type CharIssue, type IssueTotals } from './issues';

export type Newline = 'lf' | 'crlf' | 'none';

export type CountOptions = {
  /** 改行を何バイト（何文字）として数えるか */
  newline: Newline;
};

export type CountResult = {
  /** 見た目の文字数（絵文字や結合文字を1文字と数える） */
  graphemes: number;
  /** コードポイント数（MySQL の VARCHAR(n) などの文字数） */
  codePoints: number;
  /** UTF-16 のコード単位数（JavaScript の length、Java の String#length） */
  utf16Units: number;
  utf8Bytes: number;
  /** UTF-16 のバイト数（BOM なし） */
  utf16Bytes: number;
  /** 表現できない文字は 2 バイトとして概算 */
  sjisBytes: number;
  /** 表現できない文字は 2 バイトとして概算 */
  eucjpBytes: number;
  halfWidth: number;
  fullWidth: number;
  lines: number;
  /** Shift_JIS で表現できない文字 */
  unsupported: CharIssue[];
  /** EUC-JP で表現できない文字 */
  unsupportedEuc: CharIssue[];
  /** Shift_JIS（CP932）の機種依存文字 */
  vendor: CharIssue[];
  /** 詳細を保持していない種類も含む、全文の種類数。 */
  issueTotals: IssueTotals;
};

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

function countGraphemes(text: string): number {
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

const newlineBytes = (o: CountOptions) => (o.newline === 'crlf' ? 2 : o.newline === 'lf' ? 1 : 0);

/** 文字数・バイト数を数える */
export function countText(input: string, o: CountOptions): CountResult {
  const text = input.replace(/\r\n?/g, '\n');
  const nl = newlineBytes(o);
  /**
   * 見た目の文字数は行ごとに数える。改行を除いて連結すると、別の行の文字どうしが結合される（🇯 と 🇵 が国旗になるなど）。
   * 改行を除いた本文や行の配列は作らない（800万文字の入力で、同じ大きさの文字列を何度も作らないため）
   */
  let graphemes = 0;
  let newlines = 0;
  for (let start = 0; ; newlines++) {
    const end = text.indexOf('\n', start);
    graphemes += countGraphemes(text.slice(start, end < 0 ? text.length : end));
    if (end < 0) break;
    start = end + 1;
  }
  const bodyLength = text.length - newlines;

  let codePoints = 0;
  let sjis = 0;
  let euc = 0;
  let half = 0;
  let full = 0;
  const unsupported = new IssueList();
  const unsupportedEuc = new IssueList();
  const vendor = new IssueList();
  let line = 1;
  let column = 0;
  for (const ch of text) {
    if (ch === '\n') {
      line++;
      column = 0;
      continue;
    }
    column++;
    codePoints++;
    const b = sjisBytesOf(ch);
    const e = eucjpBytesOf(ch);
    /** 診断の対象かは、全件の集約（issues.ts の aggregateIssues）と同じ関数で決める */
    const sjisReason = issueReasonOf(ch, 'unsupported', b, e);
    if (sjisReason !== null) unsupported.add(ch, sjisReason, line, column);
    const eucReason = issueReasonOf(ch, 'unsupportedEuc', b, e);
    if (eucReason !== null) unsupportedEuc.add(ch, eucReason, line, column);
    const vendorReason = issueReasonOf(ch, 'vendor', b, e);
    if (vendorReason) vendor.add(ch, vendorReason, line, column);
    sjis += b ?? 2;
    euc += e ?? 2;
    if (b === 1) half++;
    else full++;
  }

  return {
    graphemes: graphemes + newlines * nl,
    codePoints: codePoints + newlines * nl,
    utf16Units: bodyLength + newlines * nl,
    /** LF のまま数えて（LF は1バイト）、改行分だけ補正する。改行を消してから数えると、別の行の不完全なサロゲートが結合される */
    utf8Bytes: utf8Length(text) + newlines * (nl - 1),
    utf16Bytes: (bodyLength + newlines * nl) * 2,
    sjisBytes: sjis + newlines * nl,
    eucjpBytes: euc + newlines * nl,
    halfWidth: half,
    fullWidth: full,
    lines: text === '' ? 0 : newlines + 1,
    unsupported: unsupported.list(),
    unsupportedEuc: unsupportedEuc.list(),
    vendor: vendor.list(),
    issueTotals: { unsupported: unsupported.total, unsupportedEuc: unsupportedEuc.total, vendor: vendor.total },
  };
}
