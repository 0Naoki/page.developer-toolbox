import { codePointOf, MAX_LISTED } from './characterDetails';

/** 不可視文字の見える化で表示する長さ（UTF-16 の単位） */
export const INVISIBLE_PREVIEW_LENGTH = 2000;

type InvisibleInfo = { marker: string; name: string };
const INVISIBLE_NAMES: Record<number, InvisibleInfo> = {
  0x09: { marker: 'TAB', name: '水平タブ' },
  0x20: { marker: 'SP', name: '半角スペース' },
  0x00a0: { marker: 'NBSP', name: 'ノーブレークスペース' },
  0x00ad: { marker: 'SHY', name: 'ソフトハイフン' },
  0x034f: { marker: 'CGJ', name: '結合書記素接合子' },
  0x061c: { marker: 'ALM', name: 'アラビア文字マーク' },
  0x115f: { marker: 'HANGUL-FILLER', name: 'ハングル字母フィラー（初声）' },
  0x1160: { marker: 'HANGUL-FILLER', name: 'ハングル字母フィラー（中声）' },
  0x180e: { marker: 'MVS', name: 'モンゴル母音分離子' },
  0x200b: { marker: 'ZWSP', name: 'ゼロ幅スペース' },
  0x200c: { marker: 'ZWNJ', name: 'ゼロ幅非接合子' },
  0x200d: { marker: 'ZWJ', name: 'ゼロ幅接合子' },
  0x200e: { marker: 'LRM', name: '左から右へのマーク' },
  0x200f: { marker: 'RLM', name: '右から左へのマーク' },
  0x2028: { marker: 'LS', name: 'Unicode 行区切り' },
  0x2029: { marker: 'PS', name: 'Unicode 段落区切り' },
  0x202a: { marker: 'LRE', name: '左から右への埋め込み' },
  0x202b: { marker: 'RLE', name: '右から左への埋め込み' },
  0x202c: { marker: 'PDF', name: '方向埋め込みの終了' },
  0x202d: { marker: 'LRO', name: '左から右への上書き' },
  0x202e: { marker: 'RLO', name: '右から左への上書き' },
  0x202f: { marker: 'NNBSP', name: '狭いノーブレークスペース' },
  0x2060: { marker: 'WJ', name: '単語接合子' },
  0x2066: { marker: 'LRI', name: '左から右への分離' },
  0x2067: { marker: 'RLI', name: '右から左への分離' },
  0x2068: { marker: 'FSI', name: '最初の強い文字による分離' },
  0x2069: { marker: 'PDI', name: '方向分離の終了' },
  0x2800: { marker: 'BRAILLE-BLANK', name: '点字空白' },
  0x3000: { marker: '全角SP', name: '全角スペース' },
  0x3164: { marker: 'HANGUL-FILLER', name: 'ハングルフィラー' },
  0xfeff: { marker: 'BOM', name: 'BOM／ゼロ幅ノーブレークスペース' },
  0xffa0: { marker: 'HANGUL-FILLER', name: '半角ハングルフィラー' },
};

function invisibleInfo(ch: string): InvisibleInfo | null {
  const cp = ch.codePointAt(0)!;
  if (INVISIBLE_NAMES[cp]) return INVISIBLE_NAMES[cp];
  if (cp >= 0xfe00 && cp <= 0xfe0f) return { marker: `VS${cp - 0xfe00 + 1}`, name: '異体字セレクタ' };
  if (cp >= 0xe0100 && cp <= 0xe01ef) return { marker: `VS${cp - 0xe0100 + 17}`, name: '異体字セレクタ' };
  if (cp > 0x20 && cp < 0x7f) return null;
  if (/\p{Cc}/u.test(ch)) return { marker: codePointOf(ch), name: '制御文字' };
  if (/\p{Cf}/u.test(ch)) return { marker: codePointOf(ch), name: '書式制御文字' };
  if (/\p{Zs}/u.test(ch)) return { marker: codePointOf(ch), name: 'Unicode 空白' };
  return null;
}

export type InvisibleOccurrence = InvisibleInfo & { codePoint: string; line: number; column: number; offset: number };
export type InvisibleInspection = {
  newlines: { crlf: number; lf: number; cr: number };
  mixedNewlines: boolean;
  kinds: (InvisibleOccurrence & { count: number })[];
  kindCount: number;
  occurrences: InvisibleOccurrence[];
  occurrenceCount: number;
  preview: { text: string; marker?: string; description?: string; newline?: boolean }[];
  previewTruncated: boolean;
};

/** 通常表示では既定の上限を使い、全件出力時は必要な一覧だけを取り出す。 */
type InspectionOptions = { kindsLimit?: number; occurrencesLimit?: number; previewLimit?: number; onOccurrence?: (item: InvisibleOccurrence) => void };

/** 元の改行を正規化せずに一度走査する。集計は全文、転送する位置・種類・プレビューだけを制限する。 */
export function inspectInvisible(input: string, options: InspectionOptions = {}): InvisibleInspection {
  const { kindsLimit = MAX_LISTED, occurrencesLimit = MAX_LISTED, previewLimit = INVISIBLE_PREVIEW_LENGTH, onOccurrence } = options;
  const newlines = { crlf: 0, lf: 0, cr: 0 };
  const kinds = new Map<string, InvisibleOccurrence & { count: number }>();
  const seenKinds = new Set<string>();
  const occurrences: InvisibleOccurrence[] = [];
  const preview: InvisibleInspection['preview'] = [];
  let occurrenceCount = 0;
  let line = 1;
  let column = 1;
  let previewEnd = 0;
  for (let offset = 0; offset < input.length;) {
    const ch = String.fromCodePoint(input.codePointAt(offset)!);
    const crlf = ch === '\r' && input[offset + 1] === '\n';
    const width = crlf ? 2 : ch.length;
    const newline = ch === '\r' || ch === '\n';
    let info: InvisibleInfo | null;
    if (newline) {
      const marker = crlf ? 'CRLF' : ch === '\r' ? 'CR' : 'LF';
      newlines[crlf ? 'crlf' : ch === '\r' ? 'cr' : 'lf']++;
      info = { marker, name: `改行（${marker}）` };
    } else info = invisibleInfo(ch);
    const codePoint = info ? (crlf ? 'U+000D U+000A' : codePointOf(ch)) : '';
    if (info) {
      const occurrence = { ...info, codePoint, line, column, offset };
      const found = kinds.get(codePoint);
      if (found) found.count++;
      else if (!seenKinds.has(codePoint) && kinds.size < kindsLimit) kinds.set(codePoint, { ...occurrence, count: 1 });
      seenKinds.add(codePoint);
      if (!newline && ch !== ' ' && ch !== '\u3000') {
        occurrenceCount++;
        if (occurrences.length < occurrencesLimit) occurrences.push(occurrence);
        onOccurrence?.(occurrence);
      }
    }
    if (offset + width <= previewLimit) {
      previewEnd = offset + width;
      if (info) preview.push({ text: '', marker: info.marker, description: `${info.name}（${codePoint}）・${line}行目 ${column}文字目`, newline });
      else {
        const last = preview.at(-1);
        if (last && !last.marker) last.text += ch;
        else preview.push({ text: ch });
      }
    }
    if (newline) { line++; column = 1; }
    else column++;
    offset += width;
  }
  return { newlines, mixedNewlines: Number(newlines.crlf > 0) + Number(newlines.lf > 0) + Number(newlines.cr > 0) > 1,
    kinds: [...kinds.values()], kindCount: seenKinds.size, occurrences, occurrenceCount, preview, previewTruncated: previewEnd < input.length };
}

/** BOM を取り除かず、文字化けを置換で隠さずに UTF-8 を読む。 */
export function decodeInspectionFile(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
