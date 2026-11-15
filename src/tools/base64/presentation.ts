import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { bytesToText, hexDump, looksBinary, sniffType, type Charset, type TextConversion } from './logic';

export type View = 'text' | 'hex';

/** 文字コードの指定だけを使って復号する。表示形式の切り替えでは、もう一度復号する必要はない。 */
export function decodedResultText(result: TextConversion, charset: Charset): string | null {
  if (result.kind !== 'bytes') return null;
  const text = bytesToText(result.bytes, charset);
  return text !== null && !looksBinary(text) ? text : null;
}

/** 表示用ダンプと、コピー・入れ替えに使う全文を区別する。バイナリのダンプは入力へ入れ替えない。 */
export function presentResult(result: TextConversion, decodedText: string | null, view: View, fromFile: boolean) {
  const sniffed = result.kind === 'bytes' ? sniffType(result.bytes) : null;
  const showHex = result.kind === 'bytes' && (view === 'hex' || decodedText === null);
  const dump = showHex && result.kind === 'bytes' ? hexDump(result.bytes) : '';
  const outputText = result.kind === 'text' ? result.output : result.kind === 'bytes' && !showHex ? decodedText ?? '' : '';
  const swapTooLarge = outputText.length > MAX_CALCULATION_INPUT;
  return { sniffed, showHex, dump, outputText, swapTooLarge, canSwap: !fromFile && outputText !== '' && !swapTooLarge };
}

/**
 * 復号したバイト列を保存するときのファイル名と MIME タイプ。
 *
 * @remarks
 * MIME タイプは data: URI の指定を優先し、なければ先頭のバイト列から判定した種類、どちらもなければ `application/octet-stream` にする。
 * 拡張子は判定した種類のものを使い、判定できなければ、テキストの MIME タイプなら `txt`、それ以外は `bin` にする。
 */
export function savedFileOf(mime: string | null, sniffed: { mime: string; ext: string } | null): { filename: string; mime: string } {
  const type = mime ?? sniffed?.mime ?? 'application/octet-stream';
  const ext = sniffed?.ext ?? (type.startsWith('text/') ? 'txt' : 'bin');
  return { filename: `decoded.${ext}`, mime: type };
}
