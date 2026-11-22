/**
 * IPv4（number）と IPv6（bigint）で共通の、アドレスの範囲と CIDR の計算。
 *
 * @remarks
 * 手順は1つにし、アドレスの種類ごとの違い（ビット数・数の型・解析・書式・文言）は {@link Family} にまとめる。
 * IPv4 も bigint で計算すると10万件の集約・重複チェックが遅くなるため、数の演算は Family の関数を通して、
 * IPv4 は number のまま計算する。
 * ブロードキャストの有無や予約アドレス・アドレスの種別（subnetInfo・kindOf）は、種類ごとに意味が違うので、ここでは扱わない。
 */
import { splitLines } from '../../lib/text/lines';
import { detailPreview } from '../../lib/text/textPreview';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/number';

/** アドレスの種類ごとの違い。A は IPv4 なら number、IPv6 なら bigint */
export type Family<A extends number | bigint> = {
  /** アドレスのビット数（32・128） */
  bits: number;
  zero: A;
  one: A;
  add: (a: A, b: A) => A;
  sub: (a: A, b: A) => A;
  /** 2 の n 乗 */
  pow2: (n: number) => A;
  /** a が 2 の n 乗の倍数か（n ビットの大きさの CIDR の先頭にできるか） */
  aligned: (a: A, n: number) => boolean;
  /** 1つのアドレスを読む。読めなければ、理由の文言で例外を投げる関数（{@link Failure}）を返す */
  readAddress: (text: string) => A | Failure;
  /** CIDR（種類によってはマスク表記やアドレスだけも）を読み、範囲の先頭と末尾を返す。読めなければ {@link Failure} を返す */
  readRange: (text: string) => { ip: A; prefix: number; first: A; last: A } | Failure;
  format: (a: A) => string;
  /** 「先頭 - 末尾」の字句を、ゾーンID内の記号と区別して分ける。例外で候補を探索しない。 */
  splitRange: (text: string) => readonly [string, string] | null;
  /** この種類のアドレスの行か（IPv4 と IPv6 が混ざった一覧から、片方だけを読むため） */
  accepts: (line: string) => boolean;
  /** CIDR の書き方の例（エラーの文言に入れる） */
  cidrExample: string;
  /** 範囲の先頭でない CIDR を、先頭に直して読んだときの警告 */
  notAlignedWarning: (cidr: string, normalized: string) => string;
};

/**
 * 読めなかったときに、理由の文言で例外を投げる関数。
 *
 * @remarks
 * 一覧を読む処理は、読めない行ごとに例外を作らず（例外は重く、100万行で10秒を超えて Worker が時間切れになる）、
 * これを受け取って件数だけを数える。文言が要る先頭の数件だけ、呼んで文言を取り出す（{@link reasonOf}）。
 * 文言は、例外を投げる側の関数（parseIpv4 など）と同じものになる。
 */
export type Failure = () => never;

/** 読み取りの結果が失敗か（アドレスは number・bigint、範囲はオブジェクトなので、関数なら失敗） */
export const isFailure = (value: unknown): value is Failure => typeof value === 'function';

/** 失敗の理由の文言 */
export function reasonOf(failure: Failure): string {
  try {
    return failure();
  } catch (e) {
    return errorMessage(e);
  }
}

/** 一覧の読み取りの誤り・警告で、文言を作って持つ件数（画面に出す件数。それより後ろは件数だけを数える） */
export const MAX_LIST_MESSAGES = 20;

/** 一覧の誤り・警告の、行の順で先頭 MAX_LIST_MESSAGES 件の文言と、総数 */
export function messageList() {
  const items: ListError[] = [];
  let total = 0;
  return {
    items,
    total: () => total,
    /** message は、先頭 MAX_LIST_MESSAGES 件に入るときだけ呼ぶ */
    add: (line: number, message: () => string) => {
      total++;
      if (items.length < MAX_LIST_MESSAGES) items.push({ line, message: message() });
    },
  };
}

/** 一覧の1行の CIDR */
export type RangeBlock<A extends number | bigint> = { line: number; text: string; label: string; start: A; end: A; prefix: number };

const compare = (a: number | bigint, b: number | bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** 一覧の行のうち、この種類の行の本文（# の後ろのコメントを除く）と行番号。空の行と、ほかの種類の行は除く */
function linesOf<A extends number | bigint>(f: Family<A>, text: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = [];
  splitLines(text).forEach((raw, i) => {
    const body = raw.replace(/#.*/, '').trim();
    if (body && f.accepts(raw)) out.push({ line: i + 1, body });
  });
  return out;
}

/** 開始〜終了の範囲を、それをちょうど覆う最小個数の CIDR にする */
export function rangeToCidrsIn<A extends number | bigint>(f: Family<A>, start: A, end: A): { network: A; prefix: number }[] {
  if (start > end) throw new Error('開始アドレスが終了アドレスより後ろにあります');
  const out: { network: A; prefix: number }[] = [];
  let cur = start;
  while (cur <= end) {
    /** cur を先頭にできる最大の大きさ（cur の末尾の0の数）と、残りの範囲に収まる大きさの小さい方 */
    let bits = f.bits;
    while (bits > 0 && !f.aligned(cur, bits)) bits--;
    while (bits > 0 && f.sub(f.add(cur, f.pow2(bits)), f.one) > end) bits--;
    out.push({ network: cur, prefix: f.bits - bits });
    cur = f.add(cur, f.pow2(bits));
  }
  return out;
}

/** 集約の結果。errors は行の順で先頭 MAX_LIST_MESSAGES 件、errorTotal は読めない行の総数 */
export type Aggregated<A extends number | bigint> = {
  cidrs: string[];
  addresses: A;
  errors: ListError[];
  errorTotal: number;
  /** 出力（各 CIDR の文字数＋改行1つの合計）が outputBudget を超えたため、cidrs を作るのを途中でやめた */
  exceeded: boolean;
};

const REVERSED_RANGE = '開始アドレスが終了アドレスより後ろにあります';

/**
 * CIDR・アドレスの範囲（「10.0.0.0 - 10.0.0.255」）・アドレスを1行ずつ書いた一覧を、
 * 重なりや隣り合う範囲をまとめた最小個数の CIDR にする。
 * 出力の文字数（各 CIDR の文字数＋改行1つの合計）が outputBudget を超えたら、全件の文字列を作る前にやめて exceeded にする
 */
export function aggregateIn<A extends number | bigint>(f: Family<A>, text: string, outputBudget = Infinity): Aggregated<A> {
  const ranges: [A, A][] = [];
  const errors = messageList();
  for (const { line, body } of linesOf(f, text)) {
    try {
      const range = f.splitRange(body);
      if (range) {
        const a = f.readAddress(range[0]);
        if (isFailure(a)) { errors.add(line, () => reasonOf(a)); continue; }
        const b = f.readAddress(range[1]);
        if (isFailure(b)) { errors.add(line, () => reasonOf(b)); continue; }
        if (a > b) { errors.add(line, () => REVERSED_RANGE); continue; }
        ranges.push([a, b]);
      } else {
        const parsed = f.readRange(body);
        if (isFailure(parsed)) { errors.add(line, () => reasonOf(parsed)); continue; }
        ranges.push([parsed.first, parsed.last]);
      }
    } catch (e) {
      /** 読み取りの誤りは上で例外を作らずに扱う。ここに来るのは想定していない例外だけ */
      errors.add(line, () => errorMessage(e));
    }
  }

  ranges.sort((a, b) => compare(a[0], b[0]));
  const merged: [A, A][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= f.add(last[1], f.one)) last[1] = last[1] > e ? last[1] : e;
    else merged.push([s, e]);
  }
  const cidrs: string[] = [];
  let used = 0;
  let exceeded = false;
  build: for (const [s, e] of merged) {
    for (const c of rangeToCidrsIn(f, s, e)) {
      const cidr = `${f.format(c.network)}/${c.prefix}`;
      used += cidr.length + 1;
      if (used > outputBudget) {
        exceeded = true;
        break build;
      }
      cidrs.push(cidr);
    }
  }
  const addresses = merged.reduce((n, [s, e]) => f.add(n, f.add(f.sub(e, s), f.one)), f.zero);
  return { cidrs, addresses, errors: errors.items, errorTotal: errors.total(), exceeded };
}

/** CIDR の一覧の読み取りの結果。errors・warnings は行の順で先頭 MAX_LIST_MESSAGES 件、errorTotal・warningTotal は総数 */
export type ParsedCidrList<A extends number | bigint> = {
  blocks: RangeBlock<A>[];
  errors: ListError[];
  errorTotal: number;
  warnings: ListError[];
  warningTotal: number;
};

/**
 * 1行に1つずつ書いた CIDR を読む。行の残りは名前（「10.0.0.0/16 本番VPC」）、# の後ろはコメント。
 * 範囲の先頭でない値（192.168.1.5/24）は、先頭（192.168.1.0/24）に直して読み、warnings に入れる
 */
export function parseCidrListIn<A extends number | bigint>(f: Family<A>, text: string): ParsedCidrList<A> {
  const blocks: RangeBlock<A>[] = [];
  const errors = messageList();
  const warnings = messageList();
  for (const { line, body } of linesOf(f, text)) {
    const [cidr = '', ...rest] = body.split(/\s+/);
    try {
      if (!cidr.includes('/')) {
        errors.add(line, () => `「${detailPreview(cidr)}」は CIDR（${f.cidrExample} など）の形式ではありません`);
        continue;
      }
      const parsed = f.readRange(cidr);
      if (isFailure(parsed)) {
        errors.add(line, () => reasonOf(parsed));
        continue;
      }
      const { ip, prefix, first, last } = parsed;
      const normalized = `${f.format(first)}/${prefix}`;
      if (first !== ip) warnings.add(line, () => f.notAlignedWarning(cidr, normalized));
      blocks.push({ line, text: normalized, label: rest.join(' '), start: first, end: last, prefix });
    } catch (e) {
      /** 読み取りの誤りは上で例外を作らずに扱う。ここに来るのは想定していない例外だけ */
      errors.add(line, () => errorMessage(e));
    }
  }
  return { blocks, errors: errors.items, errorTotal: errors.total(), warnings: warnings.items, warningTotal: warnings.total() };
}

/** ネットワークを newPrefix の大きさに均等に分ける（先頭から limit 件まで） */
export function splitNetworkIn<A extends number | bigint>(f: Family<A>, network: A, prefix: number, newPrefix: number, limit: number): { count: A; subnets: A[] } {
  if (!Number.isInteger(newPrefix) || newPrefix < prefix || newPrefix > f.bits) {
    throw new Error(`分割後のプレフィックス長は /${prefix}〜/${f.bits} で指定してください`);
  }
  const count = f.pow2(newPrefix - prefix);
  const size = f.pow2(f.bits - newPrefix);
  const shown = Math.min(Number(count), limit);
  const subnets: A[] = [];
  for (let i = 0, cur = network; i < shown; i++, cur = f.add(cur, size)) subnets.push(cur);
  return { count, subnets };
}

/** 一覧の行の読み取りの誤り（行番号は1から） */
export type ListError = { line: number; message: string };

/** 一覧に表示する上限（分割の結果など） */
export const MAX_ROWS = 1024;

/** 全件コピー・保存で生成する均等分割の件数上限。IPv6 の膨大な分割を列挙しないため。 */
export const MAX_SPLIT_OUTPUT_ROWS = 100_000;

/** 表示用の上限とは別に、件数上限内の均等分割を全文で出力する（Worker 内で呼ぶ）。 */
export function splitNetworkOutputIn<A extends number | bigint>(f: Family<A>, network: A, prefix: number, newPrefix: number): string {
  const { count } = splitNetworkIn(f, network, prefix, newPrefix, 0);
  if (count > MAX_SPLIT_OUTPUT_ROWS) throw new Error(`分割結果の全件出力は${formatNumber(MAX_SPLIT_OUTPUT_ROWS)}件までです。分割元の範囲を小さくしてください。`);
  return splitNetworkIn(f, network, prefix, newPrefix, MAX_SPLIT_OUTPUT_ROWS).subnets
    .map((address) => `${f.format(address)}/${newPrefix}`).join('\n');
}

/** 重なりの検出 */

/** 範囲を持つ一覧の要素。IPv4 は number、IPv6 は bigint（同じ一覧の中では混ぜない） */
type Ranged = { start: number | bigint; end: number | bigint };

export type Overlap<B extends Ranged = RangeBlock<number>> = { a: B; b: B; kind: 'same' | 'contains' };

/** 表示する重なりの上限（入れ子が多いと組み合わせの数が大きくなるため） */
export const MAX_OVERLAPS = 1000;

/**
 * 重なっている組み合わせ。CIDR の範囲は「一方がもう一方を含む」か「重ならない」かのどちらかになる。
 * 開始アドレスの順に並べ、まだ終わっていない範囲だけと比べるので、全組み合わせを比べるより速い
 */
export function findOverlaps<B extends Ranged>(blocks: B[]): { overlaps: Overlap<B>[]; truncated: boolean } {
  const sorted = [...blocks].sort((x, y) => compare(x.start, y.start) || compare(y.end, x.end));
  const overlaps: Overlap<B>[] = [];
  let open: B[] = [];
  for (const b of sorted) {
    open = open.filter((o) => o.end >= b.start);
    for (const o of open) {
      if (overlaps.length >= MAX_OVERLAPS) return { overlaps, truncated: true };
      overlaps.push({ a: o, b, kind: o.start === b.start && o.end === b.end ? 'same' : 'contains' });
    }
    open.push(b);
  }
  return { overlaps, truncated: false };
}
