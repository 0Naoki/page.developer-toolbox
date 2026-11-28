import { aggregateIssues, describeIssue, issueReason, type CharIssue, type IssueCount, type IssueKind } from './issues';
import { inspectInvisible } from './invisible';
import { ReportText } from './reportText';

export type DiagnosticKind = IssueKind | 'invisibleKinds' | 'invisibleOccurrences';
/** 全件診断の出力上限（UTF-16単位）。表示上限とは別に、Workerからの転送・保存量を制限する。 */
export const MAX_REPORT_OUTPUT = 32_000_000;

/** 文字の表記・列の順を、出力予算の予約と実際の出力でそろえる。 */
function issueCells(item: CharIssue): (string | number)[] {
  return [JSON.stringify(item.char), item.codePoint, item.count, item.reason, item.line, item.column];
}

/** 初回の件数1の行の長さ。予約時には詳細オブジェクト・セル配列・連結文字列を作らない。 */
function minimumIssueLength(char: string, value: IssueCount, kind: IssueKind): number {
  const hexLength = char.codePointAt(0)!.toString(16).length;
  return JSON.stringify(char).length + 2 + Math.max(4, hexLength) + 1 + issueReason(char, kind).length +
    String(value.line).length + String(value.column).length + 6;
}

/**
 * 診断を省略なしのTSVへ変換する。画面からは全件取得を選んだときだけWorkerで呼ぶ。
 * @param limit - 出力上限。通常は既定値。超過時は途中の結果を返さず、分割を案内する。
 * @remarks 文字そのものはJSON文字列として出力し、タブ・改行・不完全なサロゲートも表記を保つ。
 */
export function createDiagnosticReport(input: string, kind: DiagnosticKind, limit = MAX_REPORT_OUTPUT): string {
  const output = new ReportText(limit);
  if (kind === 'invisibleOccurrences') {
    output.row(['行', '列', 'UTF-16位置', 'コードポイント', '種類']);
    inspectInvisible(input, { kindsLimit: 0, occurrencesLimit: 0, previewLimit: 0,
      onOccurrence: (item) => output.row([item.line, item.column, item.offset, item.codePoint, item.name]) });
  } else if (kind === 'invisibleKinds') {
    output.row(['コードポイント', '種類', '件数', '最初の行', '最初の列', 'UTF-16位置']);
    const result = inspectInvisible(input, { kindsLimit: Infinity, occurrencesLimit: 0, previewLimit: 0 });
    for (const item of result.kinds) output.row([item.codePoint, item.name, item.count, item.line, item.column, item.offset]);
  } else {
    output.row(['文字(JSON)', 'コードポイント', '件数', '理由', '最初の行', '最初の列']);
    let minimumLength = output.length;
    const counts = aggregateIssues(input, kind, (char, value) => {
      /** 初回の件数1の行は、最終行長の下限になる。後から件数の桁が増えた場合はrowでも確認する。 */
      minimumLength += minimumIssueLength(char, value, kind);
      output.check(minimumLength);
    });
    /** 書き出した文字から消し、集約の表と出力の文字列を同時に持ち続けない */
    for (const [char, value] of counts) {
      output.row(issueCells(describeIssue(char, value, kind)));
      counts.delete(char);
    }
  }
  return output.finish();
}
