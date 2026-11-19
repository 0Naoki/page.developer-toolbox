import { parseJsonTree, stringifyNode, type JsonNode } from '../../lib/jsonTree';
import { isBoolean, isRecord, oneOf } from '../../lib/settings';
import { detailPreview } from '../../lib/text/textPreview';
import { checkCells, isDelimiter, MAX_CSV_OUTPUT, maxColumns, type Delimiter } from './csvFormat';
import { errorMessage } from '../../lib/errors';
import { describeAt, findLoneSurrogate } from '../../lib/text/surrogate';
import { assertUniqueObjectKeys } from './validateJson';

export type JsonToCsvOptions = {
  delimiter: Delimiter;
  header: boolean;
  /** すべての値をダブルクォートで囲む */
  quoteAll: boolean;
  /** 入れ子のオブジェクトを「user.name」のような列に展開する */
  flatten: boolean;
  /** Excel で数式として実行される値（neutralizeFormula を参照）の先頭に ' を付けて無効化する */
  escapeFormulas: boolean;
  newline: '\n' | '\r\n';
};

export const DEFAULT_JSON_TO_CSV: JsonToCsvOptions = {
  delimiter: ',',
  header: true,
  quoteAll: false,
  flatten: true,
  escapeFormulas: true,
  newline: '\r\n',
};

export function isJsonToCsvOptions(value: unknown): value is JsonToCsvOptions {
  return isRecord(value) && isDelimiter(value.delimiter) && oneOf('\n', '\r\n')(value.newline) &&
    ['header', 'quoteAll', 'flatten', 'escapeFormulas'].every((key) => isBoolean(value[key]));
}

type JsonObjectNode = Extract<JsonNode, { kind: 'object' }>;

/** 1レコード分の「列名 → 値」。値は元の表記を保った構文木のまま持つ */
type JsonRecord = Map<string, JsonNode>;

function setUnique(out: JsonRecord, key: string, value: JsonNode) {
  /** 黙って上書きすると片方の値が消えるため、エラーにする */
  if (out.has(key)) {
    throw new Error(
      `項目名「${detailPreview(key)}」が重複しています（ドットを含むキーと入れ子の項目が、展開後に同じ列名になっています）`,
    );
  }
  out.set(key, value);
}

/**
 * オブジェクトを列名と値の組にする。flatten のときは入れ子を「user.name」のような列に展開する。
 * prefix は一番外側のとき undefined。空文字のキー（\{"": \{"b": 1\}\}）の下は「.b」になる
 */
function objectToRecord(obj: JsonObjectNode, flatten: boolean, prefix?: string, out: JsonRecord = new Map()) {
  for (const { name, value } of obj.entries) {
    const key = prefix === undefined ? name : `${prefix}.${name}`;
    if (flatten && value.kind === 'object' && value.entries.length > 0) objectToRecord(value, flatten, key, out);
    else setUnique(out, key, value);
  }
  return out;
}

/** 全角の ＝ ＋ － ＠ も、日本語環境では数式として読まれることがある */
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;
/** 整数部と小数部の分け方を一通りにし、数字が長くても判定を桁数に比例する時間で終える */
const NUMBER_LIKE = /^[+-]?(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * CSV インジェクション対策（OWASP 推奨の方法）。
 * 「=HYPERLINK(...)」のような文字列は Excel で開くと数式として実行されるため、先頭に ' を付ける。
 * 「-5」のような数値として読める文字列は数式にならないのでそのまま。
 */
export function neutralizeFormula(s: string): string {
  return FORMULA_START.test(s) && !NUMBER_LIKE.test(s) ? `'${s}` : s;
}

function cellText(v: JsonNode | undefined, escapeFormulas: boolean): string {
  if (v === undefined) return '';
  /** 入れ子の配列・オブジェクトも、中の数値の表記を変えずに JSON として書く */
  if (v.kind !== 'scalar') return stringifyNode(v);
  if (v.raw === 'null') return '';
  if (v.raw.startsWith('"')) {
    const s = JSON.parse(v.raw) as string;
    return escapeFormulas ? neutralizeFormula(s) : s;
  }
  /** 数値・true・false は書かれたとおりに出す（9007199254740993 や 100.00 を丸めない） */
  return v.raw;
}

function quoteField(s: string, o: Pick<JsonToCsvOptions, 'delimiter' | 'quoteAll'>): string {
  const needs = o.quoteAll || s.includes(o.delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s);
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}

export type JsonToCsvResult = { csv: string; rows: number; columns: number };

export function jsonToCsv(input: string, o: JsonToCsvOptions): JsonToCsvResult {
  /**
   * JSON.parse は数値を Number に変換し、大きな整数や「100.00」の表記を変えてしまうため、
   * JSON 整形ツールと同じ、表記を保つパーサーで読む
   */
  let root: JsonNode;
  try {
    root = parseJsonTree(input).root;
  } catch (e) {
    throw new Error(`JSONとして読み込めません：${errorMessage(e)}`);
  }
  const data = root.kind === 'object' ? [root] : root.kind === 'array' ? root.items : null;
  if (data === null) throw new Error('JSONは配列（またはオブジェクト）である必要があります');
  assertUniqueObjectKeys(root);

  const lines: string[] = [];
  let outputLength = 0;
  const countOutput = (length: number) => {
    outputLength += length;
    if (outputLength > MAX_CSV_OUTPUT) throw new Error('変換結果が大きすぎます。入力を分割してください。');
  };
  const writeLine = (cells: Iterable<string>) => {
    if (lines.length > 0) countOutput(o.newline.length);
    const fields: string[] = [];
    for (const cell of cells) {
      /** JSON のエスケープを復号した後、実際に書くセルを検査する。Blob の UTF-8 化による文字の置換を防ぐ。 */
      const lone = findLoneSurrogate(cell);
      if (lone >= 0) throw new Error(`${lines.length + 1}行${fields.length + 1}列目：${describeAt(cell, lone)}が対になっていないサロゲートのため、UTF-8 の CSV にできません`);
      const field = quoteField(cell, o);
      countOutput(field.length + (fields.length > 0 ? o.delimiter.length : 0));
      fields.push(field);
    }
    if (fields.length === 0) throw new Error(`${lines.length + 1}行目に列がありません。CSVに変換するには、1列以上指定してください。`);
    /** 1列の空のセルをそのまま書くと空行になり、読み直したときに行が消える */
    if (fields.length === 1 && fields[0] === '') {
      fields[0] = '""';
      countOutput(2);
    }
    lines.push(fields.join(o.delimiter));
  };

  /** 配列の配列はそのまま行にする */
  if (data.every((r) => r.kind === 'array')) {
    const rows = data.map((r) => (r as Extract<JsonNode, { kind: 'array' }>).items);
    checkCells(rows.reduce((total, row) => total + row.length, 0));
    for (const row of rows) writeLine(row.map((cell) => cellText(cell, o.escapeFormulas)));
    return {
      csv: lines.join(o.newline),
      rows: rows.length,
      columns: maxColumns(rows),
    };
  }

  const records: JsonRecord[] = data.map((r) =>
    r.kind === 'object' ? objectToRecord(r, o.flatten) : new Map([['value', r]]),
  );
  /** 全レコードに現れる項目を、初出順に列にする */
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    for (const k of r.keys()) {
      if (seen.has(k)) continue;
      seen.add(k);
      columns.push(k);
    }
  }

  checkCells(columns.length * (records.length + Number(o.header)));
  if (o.header) {
    writeLine(columns.map((c) => o.escapeFormulas ? neutralizeFormula(c) : c));
  }
  for (const record of records) writeLine(columns.map((c) => cellText(record.get(c), o.escapeFormulas)));
  return { csv: lines.join(o.newline), rows: records.length, columns: columns.length };
}
