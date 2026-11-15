import { bytesToBase64 } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { sniffType, toDataUri, type EncodeMode, type TextConversion } from './logic';

export type Direction = 'encode' | 'decode';
export type Source = 'text' | 'file';
/** ファイルの中身はメモリ内だけで扱う。 */
export type InputFile = { name: string; type: string; bytes: Uint8Array<ArrayBuffer> };
export type ConversionSettings = { direction: Direction; mode: EncodeMode; source: Source; wrap: boolean; asDataUri: boolean };

/** URL はテキストだけ、data: URI と折り返しは標準の Base64 だけに適用する。保存された設定自体は変えない。 */
export function effectiveOptions({ direction, mode, source, wrap, asDataUri }: ConversionSettings) {
  const fromFile = direction === 'encode' && mode !== 'url' && source === 'file';
  const dataUri = fromFile && mode === 'base64' && asDataUri;
  return { fromFile, dataUri, wrapped: mode === 'base64' && wrap && !dataUri };
}

/** 上限内のファイルを同期でエンコードする。未選択は empty、変換の失敗はテキスト入力と同じ結果型にする。 */
export function convertFile(file: InputFile | null, mode: EncodeMode, dataUri: boolean, wrapped: boolean): TextConversion {
  if (!file) return { kind: 'empty' };
  try {
    const output = dataUri
      ? toDataUri(file.bytes, file.type || sniffType(file.bytes)?.mime || '')
      : bytesToBase64(file.bytes, { urlSafe: mode === 'base64url', wrap: wrapped });
    return { kind: 'text', output, warning: null };
  } catch (e) {
    return { kind: 'error', error: errorMessage(e) };
  }
}
