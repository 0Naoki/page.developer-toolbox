import { isBoolean, isRecord, oneOf } from '../../lib/settings';
import { checkCells, isDelimiter, MAX_CSV_OUTPUT, maxColumns, type Delimiter, type Direction } from './csvFormat';
import { parseCsv } from './parseCsv';
import { formatNumber } from '../../lib/number';

/**
 * 項目名と値の組を、書かれた順のまま JSON のオブジェクトにする。
 * JavaScript のオブジェクトを経由すると、整数に見える項目名（「2024」など）が先頭へ並べ替えられる
 */
function objectJson(names: string[], values: unknown[], indent: number): string {
  if (names.length === 0) return '{}';
  const members = names.map((name, i) => `${JSON.stringify(name)}:${indent ? ' ' : ''}${JSON.stringify(values[i])}`);
  return indent ? `{\n${' '.repeat(indent)}${members.join(`,\n${' '.repeat(indent)}`)}\n}` : `{${members.join(',')}}`;
}

/** 配列全体を一度に文字列化せず、行を追加するたびに出力上限を確認する。 */
function stringifyRows<T>(rows: T[], indent: number, toJson: (row: T) => string = (row) => JSON.stringify(row, null, indent)): string {
  if (rows.length === 0) return '[]';
  const padding = ' '.repeat(indent);
  const open = indent ? '[\n' : '[';
  const parts: string[] = [open];
  let length = open.length + (indent ? 2 : 1);
  for (const [i, row] of rows.entries()) {
    const json = toJson(row);
    const part = (i > 0 ? (indent ? ',\n' : ',') : '') + (indent ? padding + json.replace(/\n/g, '\n' + padding) : json);
    length += part.length;
    if (length > MAX_CSV_OUTPUT) throw new Error('変換結果が大きすぎます。入力を分割してください。');
    parts.push(part);
  }
  parts.push(indent ? '\n]' : ']');
  return parts.join('');
}

export type CsvToJsonOptions = {
  delimiter: Delimiter;
  /** 1行目を項目名として使う（オブジェクトの配列にする） */
  header: boolean;
  /** 数値・真偽値・null を型変換する（先頭0の「0123」などは文字列のまま） */
  inferTypes: boolean;
  /** 空行を読み飛ばす */
  skipEmptyLines: boolean;
  /** 区切り文字の直後の空白を読み飛ばす */
  skipInitialSpace: boolean;
  indent: number;
};

export const DEFAULT_CSV_TO_JSON: CsvToJsonOptions = {
  delimiter: ',',
  header: true,
  inferTypes: true,
  skipEmptyLines: true,
  skipInitialSpace: false,
  indent: 2,
};

export function isCsvToJsonOptions(value: unknown): value is CsvToJsonOptions {
  return isRecord(value) && isDelimiter(value.delimiter) && oneOf(0, 2, 4)(value.indent) &&
    ['header', 'inferTypes', 'skipEmptyLines', 'skipInitialSpace'].every((key) => isBoolean(value[key]));
}

export function inferValue(s: string): string | number | boolean | null {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  /**
   * 数値に変換して元の表記に戻る値だけを数値にする。
   * 「00123」（社員番号）、「100.00」（金額）、「1.10」（版数）、「1e5」、桁の大きい整数などは文字列のまま残す。
   * 整数の表記は、安全な整数（±(2^53 - 1)）の範囲に限る。「1000000000000000100」は表記上は往復するが、
   * 読み込み先で倍精度の数値として扱われると 1000000000000000128 になるため。
   */
  const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.exec(s);
  if (number) {
    const n = Number(s);
    const isIntegerNotation = number[2] === undefined && number[3] === undefined;
    if (String(n) === s && (!isIntegerNotation || Number.isSafeInteger(n))) return n;
  }
  return s;
}

/**
 * 重複・空の項目名を一意な名前にする。前後の空白も項目名の一部として残す（RFC 4180）。
 * 元の項目名を先に予約し、連番を付けた名前が元の項目名（「a_2」など）や
 * ほかに付けた連番と衝突しないようにする。
 */
export function uniqueHeaders(headers: string[]): string[] {
  const bases = headers.map((h, i) => h || `column${i + 1}`);
  const used = new Set(bases);
  const assigned = new Set<string>();
  /** 次に試す連番（同じ名前が大量にあっても先頭から探し直さない） */
  const next = new Map<string, number>();
  return bases.map((base) => {
    if (!assigned.has(base)) {
      assigned.add(base);
      return base;
    }
    let n = next.get(base) ?? 2;
    while (used.has(`${base}_${n}`)) n++;
    next.set(base, n + 1);
    const name = `${base}_${n}`;
    used.add(name);
    return name;
  });
}

export type CsvToJsonResult = { json: string; rows: number; columns: number; warnings: string[] };

/**
 * 変換を省く空の入力か。
 *
 * @remarks
 * CSV では空白も値の一部なので、空文字だけを空とし、空白・空行の扱いは CSV の設定に任せる。
 * JSON では空白だけの入力に値がないため、空白を除いて空なら空とする。
 */
export const isEmptyConversionInput = (input: string, direction: Direction): boolean =>
  direction === 'csv2json' ? input === '' : input.trim() === '';

export function csvToJson(input: string, o: CsvToJsonOptions): CsvToJsonResult {
  const rows = parseCsv(input, o.delimiter, { skipInitialSpace: o.skipInitialSpace, skipEmptyLines: o.skipEmptyLines });
  const convert = (s: string) => (o.inferTypes ? inferValue(s) : s);
  const warnings: string[] = [];
  if (!o.skipInitialSpace && rows.some((r) => r.some((f) => /^[ \t]+"/.test(f)))) {
    warnings.push('「a, "b"」のように区切り文字の後に空白があり、ダブルクォートが文字として読み込まれています。「区切り後の空白を無視」をオンにしてください');
  }

  if (!o.header) {
    checkCells(rows.reduce((total, row) => total + row.length, 0));
    const data = rows.map((r) => r.map(convert));
    return { json: stringifyRows(data, o.indent), rows: data.length, columns: maxColumns(rows), warnings };
  }

  const [head = [], ...body] = rows;
  const width = maxColumns(body, head.length);
  checkCells(width * (body.length + 1));
  const headers = uniqueHeaders([...head, ...Array.from({ length: width - head.length }, () => '')]);
  if (new Set(head).size !== head.length) warnings.push('項目名が重複していたため、2つ目以降に連番を付けました');
  const ragged = body.filter((r) => r.length !== head.length).length;
  if (ragged > 0) warnings.push(`${formatNumber(ragged)}行で列数が項目名の数と一致しません`);

  const json = stringifyRows(body, o.indent, (r) => objectJson(headers, headers.map((_, i) => convert(r[i] ?? '')), o.indent));
  return { json, rows: body.length, columns: headers.length, warnings };
}
