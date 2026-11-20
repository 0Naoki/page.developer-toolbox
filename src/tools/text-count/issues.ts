import { codePointOf, MAX_LISTED } from './characterDetails';
import { eucjpBytesOf, reasonOf, sjisBytesOf, vendorKindOf } from './encoding';

export type IssueKind = 'unsupported' | 'unsupportedEuc' | 'vendor';
/** 注意が必要な文字。位置は最初の出現、件数は全文の出現数。 */
export type CharIssue = { char: string; codePoint: string; count: number; reason: string; line: number; column: number };
export type IssueTotals = Record<IssueKind, number>;

/**
 * 種類数には全文の集合を使い、位置・理由・件数の詳細は先頭limit種類だけに作る。
 * @param limit - 詳細を保持する種類数。通常は表示上限。
 */
export class IssueList {
  private seen = new Set<string>();
  private details = new Map<string, CharIssue>();
  private limit: number;
  constructor(limit = MAX_LISTED) { this.limit = limit; }
  add(char: string, reason: string, line: number, column: number): void {
    const found = this.details.get(char);
    if (found) { found.count++; return; }
    if (this.seen.has(char)) return;
    this.seen.add(char);
    if (this.details.size < this.limit) this.details.set(char, { char, codePoint: codePointOf(char), count: 1, reason, line, column });
  }
  get total(): number { return this.seen.size; }
  list(): CharIssue[] { return [...this.details.values()]; }
}

/** 全件出力で必要な集約値。文字はMapのキーに置き、表示用の詳細は保持しない。 */
export type IssueCount = { count: number; line: number; column: number };

/** 集約済みの文字だけを、出力時に表示用の詳細へ変換する。 */
export function describeIssue(char: string, value: IssueCount, kind: IssueKind): CharIssue {
  return { char, ...value, codePoint: codePointOf(char), reason: issueReason(char, kind) };
}

/**
 * 1文字が診断の対象か。対象なら理由、対象でなければ null。
 *
 * @remarks
 * 文字数・バイト数の計算（count.ts）と、全件の集約（aggregateIssues）の両方がこれで判定する（判定が食い違わないように）。
 * バイト数は呼び出し側が求めたもの（変換できない文字は null）を渡す。
 */
export function issueReasonOf(char: string, kind: IssueKind, sjisBytes: number | null, eucBytes: number | null): string | null {
  if (kind === 'vendor') return sjisBytes === 2 ? vendorKindOf(char) : null;
  return (kind === 'unsupportedEuc' ? eucBytes : sjisBytes) === null ? reasonOf(char) : null;
}

/** 集約で診断対象と確定した文字の理由。予算の確認では詳細オブジェクトを作らずに使う。 */
export function issueReason(char: string, kind: IssueKind): string {
  return kind === 'vendor' ? vendorKindOf(char) ?? '' : reasonOf(char);
}

/**
 * 全件取得を選んだ診断1種類だけを集約する。改行は表示の行・列と同じ規則で数える。
 * @param reserve - 新しい種類を追加する直前の出力予算の確認。失敗すれば残りを走査しない。
 */
export function aggregateIssues(input: string, kind: IssueKind, reserve?: (char: string, value: IssueCount) => void): Map<string, IssueCount> {
  const issues = new Map<string, IssueCount>();
  let line = 1;
  let column = 0;
  for (const ch of input.replace(/\r\n?/g, '\n')) {
    if (ch === '\n') { line++; column = 0; continue; }
    column++;
    const reason = kind === 'unsupportedEuc' ? issueReasonOf(ch, kind, null, eucjpBytesOf(ch)) : issueReasonOf(ch, kind, sjisBytesOf(ch), null);
    if (reason !== null) {
      const found = issues.get(ch);
      if (found) found.count++;
      else {
        const value = { count: 1, line, column };
        reserve?.(ch, value);
        issues.set(ch, value);
      }
    }
  }
  return issues;
}
