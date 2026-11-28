/** 数値・文字列・重複キーを元の表記で保持するJSON構文木。 */
import { detailPreview } from './text/textPreview';
import { endsLineAt } from './text/lines';
import { codePointCount } from './text/surrogate';

export type JsonNode =
  | { kind: 'object'; entries: { key: string; name: string; value: JsonNode }[] }
  | { kind: 'array'; items: JsonNode[] }
  /** 文字列・数値・true/false/null は元の表記のまま持つ */
  | { kind: 'scalar'; raw: string };

export class JsonSyntaxError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * BOM除去後のJSONを解析し、重複キーの警告を呼び出し側の配列へ追加する。
 * @throws 構文が不正な場合は、UTF-16位置を持つJsonSyntaxError。
 */
export function parseJsonSource(text: string, warnings: string[]): JsonNode {
  let i = 0;
  const n = text.length;
  const duplicates: { name: string; pos: number }[] = [];

  const skipSpace = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };
  const fail = (message: string, pos = i): never => {
    throw new JsonSyntaxError(message, pos);
  };
  /** text[pos] だと絵文字などのサロゲートペアの片割れだけを表示してしまうため、1文字（コードポイント）で取り出す */
  const describe = (pos: number) => (pos >= n ? '入力の終わり' : `「${String.fromCodePoint(text.codePointAt(pos)!)}」`);

  const parseString = (): string => {
    const start = i;
    i++; /** 開きの " */
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return text.slice(start, i);
      }
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('\\u の後には16進数4桁が必要です', i);
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) {
          i += 2;
        } else {
          fail(`不正なエスケープ「\\${e ?? ''}」です`, i);
        }
        continue;
      }
      if (text.charCodeAt(i) < 0x20) fail('文字列の中に改行やタブをそのまま書くことはできません（\\n や \\t を使います）', i);
      i++;
    }
    return fail('文字列が閉じられていません（" が足りません）', start);
  };

  const parseValue = (depth: number): JsonNode => {
    if (depth > 1000) fail('入れ子が深すぎます');
    skipSpace();
    const c = text[i];
    if (c === '{') return parseObject(depth);
    if (c === '[') return parseArray(depth);
    if (c === '"') return { kind: 'scalar', raw: parseString() };
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, i)) {
        i += literal.length;
        return { kind: 'scalar', raw: literal };
      }
    }
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(text);
    if (m) {
      i += m[0].length;
      if (/[0-9.eE]/.test(text[i] ?? '')) fail('数値の書き方が正しくありません（先頭の0や小数点の位置を確認してください）', i);
      return { kind: 'scalar', raw: m[0] };
    }
    if (c === "'") return fail('文字列はシングルクォートではなくダブルクォートで囲みます');
    if (i >= n) return fail('値が必要ですが、入力が終わっています');
    return fail(`値が必要な位置に${describe(i)}があります`);
  };

  const parseObject = (depth: number): JsonNode => {
    i++; /** \{ */
    const entries: { key: string; name: string; value: JsonNode }[] = [];
    const seen = new Set<string>();
    skipSpace();
    if (text[i] === '}') {
      i++;
      return { kind: 'object', entries };
    }
    for (;;) {
      skipSpace();
      if (text[i] !== '"') {
        if (text[i] === '}') fail('最後の要素の後ろに余分なカンマがあります');
        fail('キーはダブルクォートで囲む必要があります');
      }
      const keyPos = i;
      const key = parseString();
      const name = JSON.parse(key) as string;
      if (seen.has(name)) duplicates.push({ name, pos: keyPos });
      seen.add(name);
      skipSpace();
      if (text[i] !== ':') fail(`キーの後には「:」が必要ですが、${describe(i)}があります`);
      i++;
      const value = parseValue(depth + 1);
      entries.push({ key, name, value });
      skipSpace();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return { kind: 'object', entries };
      }
      fail(`「,」または「}」が必要ですが、${describe(i)}があります`);
    }
  };

  const parseArray = (depth: number): JsonNode => {
    i++; /** [ */
    const items: JsonNode[] = [];
    skipSpace();
    if (text[i] === ']') {
      i++;
      return { kind: 'array', items };
    }
    for (;;) {
      skipSpace();
      if (text[i] === ']') fail('最後の要素の後ろに余分なカンマがあります');
      items.push(parseValue(depth + 1));
      skipSpace();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return { kind: 'array', items };
      }
      fail(`「,」または「]」が必要ですが、${describe(i)}があります`);
    }
  };

  const root = parseValue(0);
  skipSpace();
  if (i < n) fail('JSONの後ろに余分な文字があります');

  /**
   * 重複のたびに先頭から行数を数えると、重複が多いとき計算量が2乗になるため、最後に1回だけ数える。
   * 重複は前から順に見つかるので、位置は昇順に並んでいる
   */
  let line = 1;
  let p = 0;
  for (const d of duplicates) {
    for (; p < d.pos; p++) if (endsLineAt(text, p)) line++;
    /** 警告は件数を絞っても1件ずつ全文描画するため、長いキーは抜粋にする */
    warnings.push(`キー「${detailPreview(d.name)}」が重複しています（${line}行目）`);
  }
  return root;
}

/**
 * 「キーをソート」の並び（デコードしたキーの UTF-16 の順）。整形の出力とツリーの表示で同じ並びにする。
 * 同じキーが重複していれば、元の順のまま並べる（安定ソート）
 */
export function sortedEntries(node: Extract<JsonNode, { kind: 'object' }>): Extract<JsonNode, { kind: 'object' }>['entries'] {
  return [...node.entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 元の値の表記を保って構文木を出力する。
 * @param unit - インデント文字列。nullなら改行なしで圧縮する。
 * @param maxLength - 出力の上限（UTF-16単位）。超える前に例外を投げる。
 */
export function serializeJsonTree(node: JsonNode, unit: string | null, sortKeys: boolean, level: number, maxLength = Infinity): string {
  const chunks: string[] = [];
  let length = 0;
  const append = (text: string) => {
    length += text.length;
    if (length > maxLength) throw new Error('整形結果が大きすぎます。圧縮を選ぶか、入力を分割してください。');
    chunks.push(text);
  };
  const pad = (l: number) => (unit === null ? '' : unit.repeat(l));
  const nl = unit === null ? '' : '\n';
  /** 子の出力を何度も連結せず、最終結果の長さを確かめながら一度だけ結合する。 */
  const visit = (value: JsonNode, depth: number) => {
    if (value.kind === 'scalar') { append(value.raw); return; }
    const array = value.kind === 'array';
    append(array ? '[' : '{');
    if (value.kind === 'array') {
      value.items.forEach((item, i) => {
        append((i === 0 ? '' : ',') + nl + pad(depth + 1));
        visit(item, depth + 1);
      });
      if (value.items.length > 0) append(nl + pad(depth));
    } else {
      const entries = sortKeys ? sortedEntries(value) : value.entries;
      entries.forEach((entry, i) => {
        append((i === 0 ? '' : ',') + nl + pad(depth + 1) + entry.key + (unit === null ? ':' : ': '));
        visit(entry.value, depth + 1);
      });
      if (entries.length > 0) append(nl + pad(depth));
    }
    append(array ? ']' : '}');
  };
  visit(node, level);
  return chunks.join('');
}

/** pos の位置の行と列（どちらも1から）。列はコードポイントで数える */
export function lineColumn(text: string, pos: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < pos; i++) {
    if (!endsLineAt(text, i)) continue;
    line++;
    lineStart = i + 1;
  }
  return { line, column: codePointCount(text.slice(lineStart, pos)) + 1 };
}

/**
 * 値の表記を保ったまま構文木にする（ほかのツールから使う）。
 * 構文エラーは「○行○列目：理由」のメッセージで投げる。重複キーなどは warnings に入る
 */
export function parseJsonTree(input: string): { root: JsonNode; warnings: string[] } {
  const text = input.replace(/^\uFEFF/, '');
  const warnings: string[] = [];
  try {
    return { root: parseJsonSource(text, warnings), warnings };
  } catch (e) {
    if (e instanceof JsonSyntaxError) {
      const { line, column } = lineColumn(text, e.pos);
      throw new Error(`${line}行${column}列目：${e.message}`);
    }
    throw e;
  }
}

/** 構文木を1行の JSON に戻す。数値と文字列は元の表記のまま */
export const stringifyNode = (node: JsonNode): string => serializeJsonTree(node, null, false, 0);
