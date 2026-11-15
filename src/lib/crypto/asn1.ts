/**
 * ASN.1 の DER（証明書の中身の形式）を読む最小限の解析器。
 * 要素は「タグ・長さ・値」の繰り返しで、構造型（SEQUENCE など）の値はさらに要素の並びになっている。
 * 不正な入力で範囲外を読んだり無限に再帰したりしないよう、長さと深さを必ず確かめる。
 */
import { toHex } from '../bytes';
import { daysInMonth } from '../time/date';
import { detailPreview } from '../text/textPreview';

export type TagClass = 'universal' | 'application' | 'context' | 'private';

export type Node = {
  tagClass: TagClass;
  constructed: boolean;
  tag: number;
  /** 要素全体（タグから値の終わりまで）の範囲 */
  start: number;
  end: number;
  /** 値の範囲 */
  valueStart: number;
  bytes: Uint8Array;
  children: Node[];
};

export const TAG = {
  BOOLEAN: 1,
  INTEGER: 2,
  BIT_STRING: 3,
  OCTET_STRING: 4,
  NULL: 5,
  OID: 6,
  UTF8_STRING: 12,
  SEQUENCE: 16,
  SET: 17,
  PRINTABLE_STRING: 19,
  T61_STRING: 20,
  IA5_STRING: 22,
  UTC_TIME: 23,
  GENERALIZED_TIME: 24,
  VISIBLE_STRING: 26,
  UNIVERSAL_STRING: 28,
  BMP_STRING: 30,
} as const;

/** タグの先頭2ビット（0〜3）に対応するクラス */
const CLASSES = ['universal', 'application', 'context', 'private'] as const satisfies readonly TagClass[];
const MAX_DEPTH = 64;
/**
 * 通常の証明書や128ビットのUUIDを含むOIDには十分な余裕を持たせつつ、
 * シフトするBigIntと表示文字列が際限なく大きくなる入力は、計算前に拒否する。
 */
const MAX_OID_BYTES = 128;
const MAX_OID_COMPONENT_BYTES = 32;

export class Asn1Error extends Error {}

/**
 * DER の指定範囲から1つの ASN.1 要素を読む。
 *
 * @remarks
 * 戻り値の範囲とバイト列は入力を参照する。この関数は後続データを許容するため、
 * 入力全体が1要素であることを要求する呼び出し側は `parseDerExact` を使う。
 *
 * @param bytes - 解析対象の DER バイト列。
 * @param offset - 読み始めるバイト位置。既定は 0。
 * @param end - 読み取り範囲の終端（含まない）。既定は入力の長さ。
 * @param depth - 再帰の深さ。外部からは通常指定しない。
 * @returns 元の範囲と子要素を持つ解析結果。
 * @throws `Asn1Error` データの欠損、不正な形式、長さ・深さなどの上限超過の場合。
 */
export function parseDer(bytes: Uint8Array, offset = 0, end = bytes.length, depth = 0): Node {
  if (depth > MAX_DEPTH) throw new Asn1Error('入れ子が深すぎます');
  const need = (n: number, at: number) => {
    if (at + n > end) throw new Asn1Error('データが途中で切れています');
  };
  /** 範囲（end）の中の1バイトを読む。範囲の外は、途中で切れたデータとして拒否する */
  const byteAt = (at: number): number => {
    const b = bytes[at];
    if (b === undefined || at >= end) throw new Asn1Error('データが途中で切れています');
    return b;
  };
  let p = offset;
  need(2, p);
  const first = byteAt(p++);
  const tagClass = CLASSES[(first >> 6) as 0 | 1 | 2 | 3];
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    /** 31以上のタグ番号は、続くバイトの下位7ビットを並べる */
    tag = 0;
    for (let i = 0; ; i++) {
      need(1, p);
      const b = byteAt(p++);
      tag = tag * 128 + (b & 0x7f);
      if (!(b & 0x80)) break;
      if (i >= 3) throw new Asn1Error('タグ番号が大きすぎます');
    }
  }
  need(1, p);
  let length = byteAt(p++);
  if (length === 0x80) throw new Asn1Error('長さ不定の形式（BER）には対応していません。DER の証明書を入力してください');
  if (length > 0x80) {
    const n = length & 0x7f;
    if (n > 4) throw new Asn1Error('要素が大きすぎます');
    need(n, p);
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + byteAt(p++);
  }
  need(length, p);
  const node: Node = { tagClass, constructed, tag, start: offset, end: p + length, valueStart: p, bytes, children: [] };
  if (constructed) {
    let q = p;
    while (q < node.end) {
      const child = parseDer(bytes, q, node.end, depth + 1);
      node.children.push(child);
      q = child.end;
    }
  }
  return node;
}

/** データ全体がちょうど1つの要素であるとして読む */
export function parseDerExact(bytes: Uint8Array): Node {
  const node = parseDer(bytes);
  if (node.end !== bytes.length) throw new Asn1Error('要素の後ろに余分なデータがあります');
  return node;
}

export const valueOf = (n: Node): Uint8Array => n.bytes.subarray(n.valueStart, n.end);
export const rawOf = (n: Node): Uint8Array => n.bytes.subarray(n.start, n.end);

export const isUniversal = (n: Node | undefined, tag: number): n is Node =>
  n !== undefined && n.tagClass === 'universal' && n.tag === tag;
export const isContext = (n: Node | undefined, tag: number): n is Node =>
  n !== undefined && n.tagClass === 'context' && n.tag === tag;

/** 期待する型の要素であることを確かめる */
export function assertTag(n: Node | undefined, tag: number, what: string): Node {
  if (!isUniversal(n, tag)) throw new Asn1Error(`${what}を読めません（形式が違います）`);
  return n;
}

export function readOid(n: Node): string {
  const v = valueOf(n);
  if (v.length === 0) throw new Asn1Error('OID が空です');
  if (v.length > MAX_OID_BYTES) throw new Asn1Error(`OID が長すぎます（${MAX_OID_BYTES}バイトまで）`);
  /** 「2.25.\<UUID の128ビット\>」のような大きな値もあるため、Number（53ビットまで正確）ではなく BigInt で組み立てる */
  const parts: bigint[] = [];
  let value = 0n;
  let componentBytes = 0;
  for (const b of v) {
    if (++componentBytes > MAX_OID_COMPONENT_BYTES) throw new Asn1Error(`OID の成分が長すぎます（${MAX_OID_COMPONENT_BYTES}バイトまで）`);
    value = (value << 7n) | BigInt(b & 0x7f);
    if (!(b & 0x80)) {
      parts.push(value);
      value = 0n;
      componentBytes = 0;
    }
  }
  /** 最後のバイトが「続きがある」（0x80）のまま終わっていれば、最後の値が途中で切れている */
  if (parts.length === 0 || (v.at(-1) ?? 0) & 0x80) throw new Asn1Error('OID が途中で切れています');
  const first = parts.shift()!;
  /** 先頭の値は「1つ目 × 40 + 2つ目」（1つ目が2のときは2つ目が40以上になりうる） */
  const a = first < 40n ? 0n : first < 80n ? 1n : 2n;
  return [a, first - a * 40n, ...parts].join('.');
}

/** バージョン・pathLen・ソルト長など、小さな数を表す INTEGER の長さの上限 */
export const SMALL_INTEGER_BYTES = 8;

/**
 * INTEGER を読む。maxBytes より長い値は変換前に断る（入力の上限内でも、数百KBの整数を読むと時間がかかるため）。
 * 1バイトずつ BigInt をずらして結合すると計算量が長さの2乗になるため、16進数の文字列からまとめて変換する
 */
export const readInteger = (n: Node, maxBytes: number): bigint => {
  /** OCTET STRING などの中身を整数として読まない */
  if (!isUniversal(n, TAG.INTEGER) || n.constructed) throw new Asn1Error('INTEGER ではありません');
  const v = valueOf(n);
  if (v.length > maxBytes) throw new Asn1Error(`整数が長すぎます（${maxBytes}バイトまで）`);
  let hex = '';
  for (const b of v) hex += b.toString(16).padStart(2, '0');
  const x = hex ? BigInt(`0x${hex}`) : 0n;
  /** 先頭ビットが1なら負の数（2の補数） */
  return (v[0] ?? 0) & 0x80 ? x - (1n << BigInt(v.length * 8)) : x;
};

export const readBoolean = (n: Node): boolean => valueOf(n)[0] !== 0;

/** BIT STRING の中身（先頭の「未使用ビット数」を除いたバイト列） */
export function readBitString(n: Node): { bytes: Uint8Array; unused: number } {
  const v = valueOf(n);
  return { bytes: v.subarray(1), unused: v[0] ?? 0 };
}

/** 1バイト1文字として読む（引数の展開は大きな値で RangeError になるため、ループで組み立てる） */
function latin1(v: Uint8Array): string {
  let s = '';
  for (const b of v) s += String.fromCharCode(b);
  return s;
}

export function readString(n: Node): string {
  const v = valueOf(n);
  switch (n.tag) {
    case TAG.UTF8_STRING:
      return new TextDecoder('utf-8').decode(v);
    case TAG.BMP_STRING: {
      let s = '';
      for (let i = 0; i + 1 < v.length; i += 2) s += String.fromCharCode(((v[i] ?? 0) << 8) | (v[i + 1] ?? 0));
      return s;
    }
    case TAG.UNIVERSAL_STRING: {
      let s = '';
      for (let i = 0; i + 3 < v.length; i += 4) {
        s += String.fromCodePoint((((v[i] ?? 0) << 24) | ((v[i + 1] ?? 0) << 16) | ((v[i + 2] ?? 0) << 8) | (v[i + 3] ?? 0)) >>> 0);
      }
      return s;
    }
    default:
      /** PrintableString・IA5String・VisibleString・T61String（実際には ASCII か Latin-1） */
      return latin1(v);
  }
}

/**
 * UTCTime（YYMMDDHHMMSSZ）と GeneralizedTime（YYYYMMDDHHMMSSZ）を読む。
 * UTCTime の2桁の年は、50以上を1900年代、50未満を2000年代とする（RFC 5280）
 * 小数部は切り捨てずに拒否する（証明書の GeneralizedTime では RFC 5280 4.1.2.5.2 により禁止）。
 */
export function readTime(n: Node): Date {
  const s = latin1(valueOf(n));
  if (n.tag === TAG.GENERALIZED_TIME && s.includes('.')) {
    throw new Asn1Error(`日時「${detailPreview(s)}」：証明書の日時に小数部は使えません`);
  }
  const m =
    n.tag === TAG.UTC_TIME
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})$/.exec(s)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(Z|[+-]\d{4})$/.exec(s);
  if (!m) throw new Asn1Error(`日時「${detailPreview(s)}」を読めません`);
  /** 秒以外の組は正規表現で必ず一致する（既定値は型のためだけ） */
  const [, yearText = '', monthText = '', dayText = '', hourText = '', minuteText = '', secondText = '00', zone = 'Z'] = m;
  let year = Number(yearText);
  if (n.tag === TAG.UTC_TIME) year += year >= 50 ? 1900 : 2000;
  /** new Date は「2月30日」を3月2日に、「24時」を翌日に繰り上げるため、先に範囲を確かめる */
  const [month, day, hour, minute, second] = [monthText, dayText, hourText, minuteText, secondText].map(Number) as [number, number, number, number, number];
  const days = month >= 1 && month <= 12 ? daysInMonth(year, month) : 0;
  if (!days || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) {
    throw new Asn1Error(`日時「${detailPreview(s)}」は存在しない日付・時刻です`);
  }
  const tz = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const iso = `${String(year).padStart(4, '0')}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${tz}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Asn1Error(`日時「${detailPreview(s)}」を読めません`);
  return date;
}

/** 証明書では、シリアル番号やフィンガープリントを大文字の16進数で表示する */
export const toUpperHex = (v: Uint8Array, sep = ''): string => toHex(v, sep, true);
