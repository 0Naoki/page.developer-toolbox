import type { Delimiter } from './csvFormat';

export type ParseOptions = {
  /**
   * 区切り文字の直後の空白を読み飛ばす（Python の csv の skipinitialspace と同じ）。
   * 手書きの CSV によくある「a, "b,c"」を正しく2列として読める。
   * 値の先頭の空白も消えるため既定はオフ。
   */
  skipInitialSpace?: boolean;
  /** 空行を読み飛ばす。引用された空文字（""）だけの行は空行ではない */
  skipEmptyLines?: boolean;
};

/**
 * RFC 4180 準拠の CSV パーサ。
 * ダブルクォート内のカンマ・改行、"" によるエスケープに対応する。
 */
export function parseCsv(input: string, delimiter: Delimiter = ',', options: ParseOptions = {}): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotedLine = 0;
  let line = 1;
  /** フィールドの先頭（まだ何も読んでいない）か */
  let atStart = true;
  /** 閉じたダブルクォートの直後か（区切り文字か改行しか続けられない） */
  let afterQuote = false;
  let lineStart = 0;
  const isSkippable = (c: string) => c === ' ' || (c === '\t' && delimiter !== '\t');

  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        /** 引用符の外と同じく CR・LF・CRLF を1つの改行として数え、エラーの行と列をそろえる（値の改行の文字は変えない） */
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) {
          line++;
          lineStart = i + 1;
        }
        field += c;
      }
      continue;
    }
    /** "abc"def の def を黙って値に足すと、元と違う値になるため、位置を示してエラーにする */
    if (afterQuote && c !== delimiter && c !== '\n' && c !== '\r') {
      const column = Array.from(text.slice(lineStart, i)).length + 1;
      throw new Error(`${line}行${column}列目：閉じたダブルクォートの後に「${String.fromCodePoint(text.codePointAt(i)!)}」があります。値の中の " は "" と書き、値全体をダブルクォートで囲んでください`);
    }
    afterQuote = false;
    if (atStart && options.skipInitialSpace && isSkippable(c)) continue;
    if (c === '"' && atStart) {
      inQuotes = true;
      quotedLine = line;
      atStart = false;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      atStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      /** 引用された空文字（""）の行は、1列の CSV の空のセルなので空行として扱わない */
      if (!options.skipEmptyLines || !atStart || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = '';
      line++;
      lineStart = i + 1;
      atStart = true;
    } else {
      field += c;
      atStart = false;
    }
  }
  if (inQuotes) throw new Error(`${quotedLine}行目で始まるダブルクォートが閉じられていません`);
  /** 引用された空文字（""）も「フィールドを読み始めた」とみなして行に残す */
  if (!atStart || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
