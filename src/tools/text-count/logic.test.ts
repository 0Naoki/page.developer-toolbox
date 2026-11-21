/** 検査の対象：logic.ts・count.ts・encoding.ts・invisible.ts・issues.ts・characterDetails.ts（全件出力との整合はreports.test.tsでも検査する） */
import { describe, expect, it } from 'vitest';
import { countText } from './count';
import { countInputPreviewLimit } from './characterDetails';
import { eucjpBytesOf, reasonOf, sjisBytesOf, vendorKindOf } from './encoding';
import { decodeInspectionFile, inspectInvisible } from './invisible';
import { analysisOf, linesPage, measureText, measureOf, splitByEncodable, type PageOptions, type TextAnalysis } from './logic';

/** テストの補助：画面と同じく、全文を計測（Worker の measureText）してから、1ページ分を合わせる（analysisOf） */
const analyzeText = (input: string, options: Parameters<typeof measureText>[1] & PageOptions): TextAnalysis =>
  analysisOf(input, measureText(input, options), options);

it('多種類の補助平面文字だけ入力表示を短くし、反復・日本語の通常表示は維持する', () => {
  expect(countInputPreviewLimit('日本語とASCII'.repeat(1000))).toBe(2000);
  expect(countInputPreviewLimit('😀'.repeat(100_000))).toBe(2000);
  expect(countInputPreviewLimit(Array.from({ length: 1000 }, (_, i) => String.fromCodePoint(0x10000 + i)).join(''))).toBe(500);
  expect(countInputPreviewLimit('a'.repeat(2000) + Array.from({ length: 1000 }, (_, i) => String.fromCodePoint(0x10000 + i)).join(''))).toBe(2000);
});

it('改行を挟む不完全なサロゲートを、UTF-8の集計で結合しない', () => {
  for (const separator of ['\n', '\r', '\r\n']) {
    const input = '\uD83D' + separator + '\uDE00';
    for (const [newline, bytes] of [['lf', 7], ['crlf', 8], ['none', 6]] as const) {
      expect(countText(input, { newline }).utf8Bytes).toBe(bytes);
      const measurement = measureText(input, { newline, measure: 'utf8' });
      expect(Array.from(measurement.values)).toEqual([3, 3]);
      expect(measurement.counts.utf8Bytes).toBe(bytes);
    }
  }
});

describe('不可視文字と元の改行の検査', () => {
  it('CRLFは1改行として数え、LF・CRの混在と元の位置を示す', () => {
    const result = inspectInvisible('😀\u00a0\r\n\tA\u200b\nB\ufeff\rC');
    expect(result.newlines).toEqual({ crlf: 1, lf: 1, cr: 1 });
    expect(result.mixedNewlines).toBe(true);
    expect(result.occurrences).toMatchObject([
      { marker: 'NBSP', codePoint: 'U+00A0', line: 1, column: 2, offset: 2 },
      { marker: 'TAB', codePoint: 'U+0009', line: 2, column: 1, offset: 5 },
      { marker: 'ZWSP', codePoint: 'U+200B', line: 2, column: 3, offset: 7 },
      { marker: 'BOM', codePoint: 'U+FEFF', line: 3, column: 2, offset: 10 },
    ]);
    expect(result.kinds.find((kind) => kind.marker === 'CRLF')).toMatchObject({ codePoint: 'U+000D U+000A', count: 1, line: 1, column: 3 });
  });

  it('通常の空白とタブも可視化し、方向制御文字を生のままプレビューへ出さない', () => {
    const result = inspectInvisible('A \u3000\t\u202eB\u202c\u2066C\u2069');
    expect(result.preview.filter((part) => part.marker).map((part) => part.marker)).toEqual(['SP', '全角SP', 'TAB', 'RLO', 'PDF', 'LRI', 'PDI']);
    expect(result.preview.map((part) => part.text).join('')).toBe('ABC');
    expect(result.occurrenceCount).toBe(5);
  });

  it('絵文字の接合子・異体字セレクタと補助面のセレクタを識別する', () => {
    const result = inspectInvisible('👨\u200d👩\ufe0f葛\u{e0100}');
    expect(result.occurrences).toMatchObject([
      { marker: 'ZWJ', codePoint: 'U+200D', column: 2, offset: 2 },
      { marker: 'VS16', codePoint: 'U+FE0F', column: 4, offset: 5 },
      { marker: 'VS17', codePoint: 'U+E0100', column: 6, offset: 7 },
    ]);
  });

  it('名前を列挙していない制御文字・書式制御・Unicode空白も検出する', () => {
    const result = inspectInvisible('\u0000\u000b\u007f\u0085\u2007\u2063\u2028\u2029\u3164');
    expect(result.occurrenceCount).toBe(9);
    expect(result.kinds.map((kind) => kind.codePoint)).toEqual(['U+0000', 'U+000B', 'U+007F', 'U+0085', 'U+2007', 'U+2063', 'U+2028', 'U+2029', 'U+3164']);
    expect(result.newlines).toEqual({ crlf: 0, lf: 0, cr: 0 });
  });

  it('空文字・通常の文字列・単一の改行コードを扱う', () => {
    expect(inspectInvisible('')).toMatchObject({ kinds: [], occurrences: [], preview: [], previewTruncated: false, mixedNewlines: false });
    expect(inspectInvisible('山田abc😀').kindCount).toBe(0);
    expect(inspectInvisible('\r\n\r\n').mixedNewlines).toBe(false);
    expect(inspectInvisible('\r\n\r\n').newlines).toEqual({ crlf: 2, lf: 0, cr: 0 });
  });

  it('10万件も全文を集計し、一覧とプレビューだけを制限する', () => {
    const input = '\u200b'.repeat(100000) + '\r\n\u00a0';
    const result = inspectInvisible(input);
    expect(result.occurrenceCount).toBe(100001);
    expect(result.occurrences).toHaveLength(100);
    expect(result.kinds.find((kind) => kind.marker === 'ZWSP')?.count).toBe(100000);
    expect(result.kinds.find((kind) => kind.marker === 'NBSP')).toMatchObject({ line: 2, column: 1, offset: 100002 });
    expect(result.preview).toHaveLength(2000);
    expect(result.previewTruncated).toBe(true);
    expect(input.endsWith('\r\n\u00a0')).toBe(true);
  });

  it('プレビューの末尾でCRLFやサロゲートペアを分断しない', () => {
    expect(inspectInvisible('a'.repeat(1999) + '😀').preview.map((part) => part.text).join('')).toBe('a'.repeat(1999));
    const result = inspectInvisible('a'.repeat(1999) + '\r\n');
    expect(result.preview.some((part) => part.marker === 'CR')).toBe(false);
    expect(result.preview.some((part) => part.marker === 'CRLF')).toBe(false);
    expect(result.newlines.crlf).toBe(1);
    expect(result.previewTruncated).toBe(true);
  });

  it('種類数の表示上限を超えても全種類を集計する', () => {
    let input = '';
    for (let cp = 0xe0100; cp < 0xe0100 + 150; cp++) input += String.fromCodePoint(cp);
    const result = inspectInvisible(input);
    expect(result.kindCount).toBe(150);
    expect(result.kinds).toHaveLength(100);
    expect(result.occurrenceCount).toBe(150);
  });

  it('UTF-8ファイルのBOM・改行を保持し、不正なUTF-8を置換で隠さない', () => {
    const input = '\ufeffA\r\nB\rC\n';
    expect(decodeInspectionFile(new TextEncoder().encode(input))).toBe(input);
    expect(() => decodeInspectionFile(new Uint8Array([0xc3, 0x28]))).toThrow();
  });

  it('改行の数え方の設定を変えても検査結果の元の改行は変わらない', () => {
    const options = { measure: 'chars', limit: null, onlyOver: false, page: 0 } as const;
    for (const newline of ['none', 'lf', 'crlf'] as const) {
      expect(analyzeText('a\r\nb\n', { ...options, newline }).invisible.newlines).toEqual({ crlf: 1, lf: 1, cr: 0 });
    }
  });
});

describe('大容量の表示用結果', () => {
  const options = { newline: 'none', measure: 'sjis', limit: 3, onlyOver: true, page: 0 } as const;
  it('表示範囲外も数え、超過行だけの2ページ目を元の行番号で返す', () => {
    const text = Array(1200).fill('a\nabcdef').join('\n');
    const result = analyzeText(text, { ...options, page: 1 });
    expect(result.counts.lines).toBe(2400);
    expect(result.counts.codePoints).toBe(8400);
    expect(result.overCount).toBe(1200);
    expect(result.matchingLines).toBe(1200);
    expect(result.visible).toHaveLength(100);
    expect(result.visible[0]).toMatchObject({ no: 202, text: 'abcdef', value: 6, over: true });
    expect(result.visible.at(-1)?.no).toBe(400);
  });
  it('長い行の表示は切り詰めても、長さは全文で計測する', () => {
    const text = 'a'.repeat(999) + '😀' + 'b'.repeat(100_000);
    const result = analyzeText(text, { ...options, measure: 'chars', onlyOver: false });
    expect(result.visible[0]).toMatchObject({ text: 'a'.repeat(999), truncated: true, value: 101000 });
    expect(result.counts.codePoints).toBe(101000);
  });
  it('上限が空なら超過行の絞り込みを解除し、空入力も扱う', () => {
    expect(analyzeText('a\nb', { ...options, limit: null }).matchingLines).toBe(2);
    expect(analyzeText('', options)).toMatchObject({ visible: [], matchingLines: 0, overCount: 0 });
  });
  it('CR・LF・CRLF の行を元の入力の位置で切り出し、改行を含めない', () => {
    const m = measureText('ab\r\ncd\reé\nf', { newline: 'none', measure: 'chars' });
    expect(Array.from(m.values)).toEqual([2, 2, 2, 1]);
    expect(linesPage('ab\r\ncd\reé\nf', m, { limit: null, onlyOver: false, page: 0 }).visible.map((l) => l.text)).toEqual(['ab', 'cd', 'eé', 'f']);
    expect(Array.from(measureText('a\n', { newline: 'none', measure: 'chars' }).values)).toEqual([1, 0]);
  });
  it('ページや上限を変えても全文を計測し直さず、集計済みの行の値から切り出す', () => {
    const text = `${'あいうえおabc😀'.repeat(200)}\n`.repeat(250);
    const m = measureText(text, { newline: 'lf', measure: 'sjis' });
    const page = linesPage(text, m, { limit: 10, onlyOver: false, page: 1 });
    expect(page.visible[0]).toMatchObject({ no: 101, value: 3000, over: true, truncated: true });
    expect(page).toMatchObject({ matchingLines: 251, overCount: 250 });
    expect(analyzeText(text, { newline: 'lf', measure: 'sjis', limit: 10, onlyOver: false, page: 1 }).visible).toEqual(page.visible);
    /** 行の値は集計済みのものだけを使い、行を計測し直さない（時間ではなく結果で確かめ、並列実行でも安定させる） */
    const fake = { ...m, values: m.values.map(() => 7) };
    expect(linesPage(text, fake, { limit: 5, onlyOver: true, page: 0 })).toMatchObject({ overCount: 251, matchingLines: 251 });
    expect(linesPage(text, fake, { limit: null, onlyOver: false, page: 0 }).visible[0]?.value).toBe(7);
    /** 単独で約2秒かかり、並行実行の負荷で vitest の既定（5秒）を超えることがあるため、枠を広げる */
  }, 30_000);
});

describe('sjisBytesOf', () => {
  it('半角は1バイト、全角は2バイト', () => {
    expect(sjisBytesOf('A')).toBe(1);
    expect(sjisBytesOf('ｱ')).toBe(1);
    expect(sjisBytesOf('あ')).toBe(2);
    expect(sjisBytesOf('漢')).toBe(2);
    expect(sjisBytesOf('Ａ')).toBe(2);
  });

  it('Windows-31J の拡張文字に対応する', () => {
    expect(sjisBytesOf('①')).toBe(2);
    expect(sjisBytesOf('㈱')).toBe(2);
    expect(sjisBytesOf('髙')).toBe(2);
  });

  it('Shift_JIS にない文字は null', () => {
    expect(sjisBytesOf('𠮷')).toBe(null);
    expect(sjisBytesOf('😀')).toBe(null);
    expect(sjisBytesOf('ⓐ')).toBe(null);
  });
});

describe('countText', () => {
  it('各種の長さを数える', () => {
    const r = countText('ｱｲｳABC漢字\n😀', { newline: 'crlf' });
    expect(r.graphemes).toBe(9 + 2); /** 見た目9文字 + 改行(CRLF)2 */
    expect(r.codePoints).toBe(9 + 2);
    expect(r.utf16Units).toBe(10 + 2); /** 絵文字はサロゲートペアで2 */
    expect(r.utf8Bytes).toBe(3 * 3 + 3 + 6 + 4 + 2);
    expect(r.sjisBytes).toBe(3 + 3 + 4 + 2 + 2);
    expect(r.halfWidth).toBe(6);
    expect(r.fullWidth).toBe(3);
    expect(r.lines).toBe(2);
    expect(r.unsupported).toEqual([{ char: '😀', codePoint: 'U+1F600', count: 1, reason: '絵文字', line: 2, column: 1 }]);
  });

  it('結合文字・家族の絵文字は見た目1文字', () => {
    expect(countText('👨‍👩‍👧', { newline: 'none' }).graphemes).toBe(1);
    expect(countText('が', { newline: 'none' }).graphemes).toBe(1);
  });

  it('別の行にある文字どうしを結合しない', () => {
    expect(countText('🇯\n🇵', { newline: 'lf' }).graphemes).toBe(3);
    expect(countText('🇯\r\n🇵', { newline: 'none' }).graphemes).toBe(2);
    expect(countText('a\ń', { newline: 'crlf' }).graphemes).toBe(4);
    expect(countText('🇯🇵\n', { newline: 'lf' }).graphemes).toBe(2);
  });

  it('改行を含めない設定', () => {
    const r = countText('a\r\nb', { newline: 'none' });
    expect(r.codePoints).toBe(2);
    expect(r.lines).toBe(2);
  });

  it('空文字', () => {
    expect(countText('', { newline: 'lf' }).lines).toBe(0);
  });
});

describe('半角の判定', () => {
  it('タブは半角1桁として数える', () => {
    const r = countText('a\tb', { newline: 'none' });
    expect([r.fullWidth, r.halfWidth]).toEqual([0, 3]);
    expect(measureOf('a\tb', 'width')).toBe(3);
    expect(measureOf('a\tb', 'sjis')).toBe(3);
  });

  it('全角と Shift_JIS にない文字は2桁', () => {
    expect(measureOf('あ😀', 'width')).toBe(4);
  });
});

describe('行ごとの長さ', () => {
  it('上限を超えた行を判定する', () => {
    const { visible } = analyzeText('山田太郎\nﾔﾏﾀﾞﾀﾛｳ\nやまだたろうさん', { newline: 'none', measure: 'sjis', limit: 10, onlyOver: false, page: 0 });
    expect(visible.map((l) => [l.value, l.over])).toEqual([
      [8, false],
      [7, false],
      [16, true],
    ]);
  });

  it('測り方ごとの値', () => {
    expect(measureOf('ｱあ', 'width')).toBe(3);
    expect(measureOf('ｱあ', 'utf8')).toBe(6);
    expect(measureOf('ｱあ', 'chars')).toBe(2);
  });
});

describe('eucjpBytesOf', () => {
  it('ASCII は1、半角カナと全角は2、補助漢字（JIS X 0212）は3バイト', () => {
    expect(eucjpBytesOf('A')).toBe(1);
    expect(eucjpBytesOf('ｱ')).toBe(2);
    expect(eucjpBytesOf('あ')).toBe(2);
    expect(eucjpBytesOf('①')).toBe(2);
    expect(eucjpBytesOf('丂')).toBe(3);
    expect(eucjpBytesOf('−')).toBe(2);
  });

  it('EUC-JP にない文字は null', () => {
    expect(eucjpBytesOf('𠮷')).toBe(null);
    expect(eucjpBytesOf('😀')).toBe(null);
  });
});

describe('機種依存文字と、表現できない理由', () => {
  it('Shift_JIS（CP932）の NEC特殊文字・IBM拡張文字を見分ける', () => {
    expect(vendorKindOf('①')).toBe('NEC特殊文字');
    expect(vendorKindOf('㈱')).toBe('NEC特殊文字');
    expect(vendorKindOf('髙')).toBe('NEC選定IBM拡張文字');
    expect(vendorKindOf('﨑')).toBe('NEC選定IBM拡張文字');
    /** JIS X 0208 にもある文字（∵）と普通の漢字は対象外 */
    expect(vendorKindOf('∵')).toBe(null);
    expect(vendorKindOf('漢')).toBe(null);
  });

  it('表現できない理由', () => {
    expect(reasonOf('𠮷')).toBe('サロゲートペア（U+10000 以上の文字）');
    expect(reasonOf('😀')).toBe('絵文字');
    expect(reasonOf('️')).toBe('異体字セレクタ（見えない文字）');
    expect(reasonOf('́')).toBe('結合文字（濁点・アクセントなど）');
    expect(reasonOf('​')).toBe('特殊な空白・見えない文字');
    expect(reasonOf('ⓐ')).toBe('');
  });
});

describe('countText（文字コードごとの数と、注意が必要な文字）', () => {
  it('EUC-JP・UTF-16 のバイト数', () => {
    const r = countText('aｱ丂𠮷', { newline: 'none' });
    expect(r.eucjpBytes).toBe(1 + 2 + 3 + 2);
    expect(r.utf16Bytes).toBe(5 * 2);
  });

  it('表現できない文字と機種依存文字を、件数と最初の位置付きで一覧にする', () => {
    const r = countText('吉野家\n𠮷野家と㈱①\n𠮷', { newline: 'lf' });
    expect(r.unsupported).toEqual([{ char: '𠮷', codePoint: 'U+20BB7', count: 2, reason: 'サロゲートペア（U+10000 以上の文字）', line: 2, column: 1 }]);
    expect(r.unsupportedEuc.map((u) => u.char)).toEqual(['𠮷']);
    expect(r.vendor).toEqual([
      { char: '㈱', codePoint: 'U+3231', count: 1, reason: 'NEC特殊文字', line: 2, column: 5 },
      { char: '①', codePoint: 'U+2460', count: 1, reason: 'NEC特殊文字', line: 2, column: 6 },
    ]);
  });

  it('EUC-JP にだけある文字（補助漢字）は、Shift_JIS では表現できない', () => {
    const r = countText('丂', { newline: 'none' });
    expect(r.unsupported.map((u) => u.char)).toEqual(['丂']);
    expect(r.unsupportedEuc).toEqual([]);
  });
});

describe('measureOf（EUC-JP・UTF-16）', () => {
  it('バイト数', () => {
    expect(measureOf('ｱあ丂', 'eucjp')).toBe(7);
    expect(measureOf('あ😀', 'utf16')).toBe(6);
  });
});

describe('splitByEncodable', () => {
  it('表現できない文字の部分を分ける（連続する部分はまとめる）', () => {
    expect(splitByEncodable('ab𠮷😀c', 'sjis')).toEqual([
      { text: 'ab', bad: false },
      { text: '𠮷😀', bad: true },
      { text: 'c', bad: false },
    ]);
    expect(splitByEncodable('丂', 'eucjp')).toEqual([{ text: '丂', bad: false }]);
    expect(splitByEncodable('', 'sjis')).toEqual([]);
  });
});
