import { eucjpBytesOf, reasonOf, sjisBytesOf, vendorKindOf } from './encoding';
import { codePointOf } from './characterDetails';

export type Newline = 'lf' | 'crlf' | 'none';

export type CountOptions = {
  /** 改行を何バイト（何文字）として数えるか */
  newline: Newline;
};

/** 注意が必要な文字（重複なし）。位置は最初に出てきた場所 */
export type CharIssue = {
  char: string;
  codePoint: string;
  count: number;
  /** 理由（絵文字・サロゲートペアなど）や、機種依存文字の種類 */
  reason: string;
  /** 1から数えた行と、行の中の文字（コードポイント）の位置 */
  line: number;
  column: number;
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
  newlines: number;
  /** Shift_JIS で表現できない文字 */
  unsupported: CharIssue[];
  /** EUC-JP で表現できない文字 */
  unsupportedEuc: CharIssue[];
  /** Shift_JIS（CP932）の機種依存文字 */
  vendor: CharIssue[];
};

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

function countGraphemes(text: string): number {
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

const newlineBytes = (o: CountOptions) => (o.newline === 'crlf' ? 2 : o.newline === 'lf' ? 1 : 0);

/** 文字ごとの出現数と最初の位置を集める */
class IssueList {
  private map = new Map<string, CharIssue>();
  add(char: string, reason: string, line: number, column: number) {
    const found = this.map.get(char);
    if (found) found.count++;
    else this.map.set(char, { char, codePoint: codePointOf(char), count: 1, reason, line, column });
  }
  list(): CharIssue[] {
    return [...this.map.values()];
  }
}

/** 文字数・バイト数を数える */
export function countText(input: string, o: CountOptions): CountResult {
  const text = input.replace(/\r\n?/g, '\n');
  const nl = newlineBytes(o);
  const newlines = (text.match(/\n/g) ?? []).length;
  const body = text.replace(/\n/g, '');
  /** 改行を除いて連結すると別の行の文字どうしが結合される（🇯 と 🇵 が国旗になるなど）ため、行ごとに数える */
  let graphemes = 0;
  for (const l of text.split('\n')) graphemes += countGraphemes(l);

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
    if (b === null) unsupported.add(ch, reasonOf(ch), line, column);
    sjis += b ?? 2;
    const e = eucjpBytesOf(ch);
    if (e === null) unsupportedEuc.add(ch, reasonOf(ch), line, column);
    euc += e ?? 2;
    const kind = b === 2 ? vendorKindOf(ch) : null;
    if (kind) vendor.add(ch, kind, line, column);
    if (b === 1) half++;
    else full++;
  }

  return {
    graphemes: graphemes + newlines * nl,
    codePoints: codePoints + newlines * nl,
    utf16Units: body.length + newlines * nl,
    /** 改行を消してから変換すると、別の行の不完全なサロゲートが結合されるため、LFのまま変換して改行分だけ補正する。 */
    utf8Bytes: new TextEncoder().encode(text).length + newlines * (nl - 1),
    utf16Bytes: (body.length + newlines * nl) * 2,
    sjisBytes: sjis + newlines * nl,
    eucjpBytes: euc + newlines * nl,
    halfWidth: half,
    fullWidth: full,
    lines: text === '' ? 0 : newlines + 1,
    newlines,
    unsupported: unsupported.list(),
    unsupportedEuc: unsupportedEuc.list(),
    vendor: vendor.list(),
  };
}
