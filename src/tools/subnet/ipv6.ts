import { splitAddressRange } from './addressRange';
/**
 * IPv6 のアドレス・プレフィックスの計算。アドレスは 128ビットなので BigInt で持つ。
 * IPv4 との違い：ブロードキャストアドレスがなく、サブネットのすべてのアドレスを使える。
 */
import { readIpv4 } from './ipv4';
import { CLOUD_RESERVED, cloudSubnetNotes } from './cloudPolicy';
import { detailPreview } from '../../lib/text/textPreview';
import { splitLines } from '../../lib/text/lines';
import { formatNumber } from '../../lib/number';
import { formatIpv6Groups } from '../../lib/ipv6';
import { aggregateIn, isFailure, MAX_ROWS, parseCidrListIn, rangeToCidrsIn, splitNetworkIn, splitNetworkOutputIn, type Aggregated, type Failure, type Family, type ParsedCidrList, type RangeBlock } from './ranges';

const BITS = 128n;
const MAX6 = (1n << BITS) - 1n;

/**
 * 行が IPv6 か。IPv4 と IPv6 が混ざった一覧を振り分けるのに使う。
 * 先頭の値（アドレスや CIDR）だけを見る（「10.0.0.0/16 本番: 東京」のように、名前に : があっても IPv4）
 */
export const isIpv6Text = (line: string): boolean => (line.replace(/#.*/, '').trim().split(/\s+/)[0] ?? '').includes(':');

/** IPv4 と IPv6 が混ざった一覧から、片方の行だけを残す（行番号を保つため、もう片方は空行にする） */
export const onlyLines = (text: string, v6: boolean): string =>
  splitLines(text)
    .map((l) => (isIpv6Text(l) === v6 ? l : ''))
    .join('\n');

/**
 * IPv6 アドレスを読む。:: による省略、末尾の IPv4 表記（::ffff:192.0.2.1）、[ ] で囲んだ表記に対応する。
 * ゾーンID（fe80::1%eth0）は空・区切り・空白を検証してから取り除く。単独アドレスではプレフィックスを受け付けない。
 */
export function parseIpv6(input: string): bigint {
  const result = readIpv6(input);
  return isFailure(result) ? result() : result;
}

/** 例外を投げずに parseIpv6 と同じ規則で読む。読めなければ、理由の文言で例外を投げる関数を返す（一覧の読み取り用） */
export function readIpv6(input: string): bigint | Failure {
  let s = input.trim();
  const shown = s;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const fail = (why: string): Failure => () => {
    throw new Error(`「${detailPreview(shown)}」は IPv6 アドレスとして読めません（${why}）`);
  };
  if (s.includes('/')) return fail('アドレスだけを指定してください');
  const zone = s.indexOf('%');
  if (zone >= 0) {
    if (!/^[\p{L}\p{N}_.~-]+$/u.test(s.slice(zone + 1))) return fail('ゾーンIDが不正です');
    s = s.slice(0, zone);
  }
  if (!s.includes(':')) return fail(': がありません');

  /** 末尾の IPv4 表記を16進数の2グループに置き換える */
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = readIpv4(tail);
    if (isFailure(v4)) return v4;
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return fail(':: は1か所にしか使えません');
  const split = (part: string) => (part === '' ? [] : part.split(':'));
  const [first = '', second] = halves;
  const head = split(first);
  const rest = second === undefined ? [] : split(second);
  /** 省略を展開する前に確かめる（多すぎると、埋める0の数が負になって配列を作れないため） */
  if (halves.length === 2 && head.length + rest.length > 7) return fail('グループが多すぎます');
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (groups.length !== 8) return fail('グループは8つ必要です（省略するときは :: を使います）');
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return fail(`「${detailPreview(g)}」は16進数4桁までのグループではありません`);
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

const groupsOf = (n: bigint) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt((7 - i) * 16)) & 0xffffn));

/** 省略しない表記（2001:0db8:0000:…） */
export const expandIpv6 = (n: bigint): string => groupsOf(n).map((g) => g.toString(16).padStart(4, '0')).join(':');

/** 推奨される表記（RFC 5952。証明書の別名と同じ表記にするため src/lib/ipv6.ts を使う） */
export const formatIpv6 = (n: bigint): string => formatIpv6Groups(groupsOf(n));

const maskOf6 = (prefix: number): bigint => (prefix === 0 ? 0n : (MAX6 << BigInt(128 - prefix)) & MAX6);

/** 「2001:db8::/32」、またはアドレスだけ（/128）を読む */
export function parseNetwork6(input: string): ParsedNetwork6 {
  const result = readNetwork6(input);
  return isFailure(result) ? result() : result;
}

type ParsedNetwork6 = { ip: bigint; prefix: number; notation: 'cidr' | 'host' };

/** 例外を投げずに parseNetwork6 と同じ規則で読む。読めなければ、理由の文言で例外を投げる関数を返す（一覧の読み取り用） */
export function readNetwork6(input: string): ParsedNetwork6 | Failure {
  const s = input.trim();
  const m = /^(.+?)\s*\/\s*(\d{1,3})$/.exec(s);
  if (s.includes('/') && (!m || m[1]?.includes('/'))) return () => { throw new Error('IPv6 のプレフィックス長は / の後に 0〜128 の整数で指定してください'); };
  if (!m) {
    const ip = readIpv6(s);
    return isFailure(ip) ? ip : { ip, prefix: 128, notation: 'host' };
  }
  const prefix = Number(m[2]);
  if (prefix > 128) return () => { throw new Error('IPv6 のプレフィックス長は 0〜128 で指定してください'); };
  const ip = readIpv6(m[1] ?? '');
  return isFailure(ip) ? ip : { ip, prefix, notation: 'cidr' };
}

export type SubnetInfo6 = {
  network: bigint;
  last: bigint;
  prefix: number;
  total: bigint;
  usable: bigint;
  first: bigint | null;
  lastUsable: bigint | null;
  notes: string[];
};

/**
 * プレフィックスの情報。
 * - /127 は機器間の接続用（RFC 6164）、/128 は1アドレス
 * - それ以外もすべてのアドレスを使える（先頭はサブネットルーターのエニーキャスト。RFC 4291）
 * - cloud のときは、AWS・Azure と同じく先頭4つと末尾1つを除く
 */
export function subnetInfo6(ip: bigint, prefix: number, cloud = false): SubnetInfo6 {
  const mask = maskOf6(prefix);
  const network = ip & mask;
  const total = 1n << BigInt(128 - prefix);
  const last = network + total - 1n;
  const notes: string[] = [];
  let first: bigint | null = network;
  let lastUsable: bigint | null = last;

  if (cloud) {
    const reserved = BigInt(CLOUD_RESERVED);
    first = total > reserved ? network + 4n : null;
    lastUsable = total > reserved ? last - 1n : null;
    notes.push(...cloudSubnetNotes(6, prefix));
  } else if (prefix === 128) {
    notes.push('/128 は1アドレスだけを表します');
  } else if (prefix === 127) {
    notes.push('/127 は機器間の接続用で、2アドレスとも使えます（RFC 6164）');
  } else {
    notes.push('IPv6 にはブロードキャストアドレスがなく、すべてのアドレスを使えます（先頭はサブネットルーターのエニーキャスト。RFC 4291）');
  }
  if (prefix > 64 && prefix < 127) notes.push('/64 より小さいサブネットでは、アドレスの自動設定（SLAAC）が使えません');

  return {
    network,
    last,
    prefix,
    total,
    usable: first === null || lastUsable === null ? 0n : lastUsable - first + 1n,
    first,
    lastUsable,
    notes,
  };
}

export const contains6 = (network: bigint, prefix: number, ip: bigint): boolean => (ip & maskOf6(prefix)) === network;

/** 128桁の2進数（16ビットごとに : で区切る） */
export const binaryOf6 = (n: bigint): string =>
  groupsOf(n)
    .map((g) => g.toString(2).padStart(16, '0'))
    .join(':');

/** 大きな数を「2^64（18,446,744,073,709,551,616）」のように書く */
export function formatCount(n: bigint): string {
  const exact = formatNumber(n);
  if (n < 1n << 20n || (n & (n - 1n)) !== 0n) return exact;
  return `2^${n.toString(2).length - 1}（${exact}）`;
}

/** 種別 */

type Special6 = { cidr: string; label: string; rfc?: string };

/** 特別な用途のアドレス（IANA IPv6 Special-Purpose Address Registry などから、よく使うもの） */
const SPECIALS6: Special6[] = [
  { cidr: '::/128', label: '未指定アドレス', rfc: 'RFC 4291' },
  { cidr: '::1/128', label: 'ループバック', rfc: 'RFC 4291' },
  { cidr: '::ffff:0:0/96', label: 'IPv4 射影アドレス', rfc: 'RFC 4291' },
  { cidr: '64:ff9b::/96', label: 'NAT64', rfc: 'RFC 6052' },
  { cidr: '100::/64', label: '破棄用', rfc: 'RFC 6666' },
  { cidr: '2000::/3', label: 'グローバルユニキャスト' },
  { cidr: '2001::/32', label: 'Teredo', rfc: 'RFC 4380' },
  { cidr: '2001:db8::/32', label: 'ドキュメント用', rfc: 'RFC 3849' },
  { cidr: '3fff::/20', label: 'ドキュメント用', rfc: 'RFC 9637' },
  { cidr: '2002::/16', label: '6to4', rfc: 'RFC 3056' },
  { cidr: 'fc00::/7', label: 'ユニークローカル（ULA。IPv4 のプライベートに相当）', rfc: 'RFC 4193' },
  { cidr: 'fe80::/10', label: 'リンクローカル', rfc: 'RFC 4291' },
  { cidr: 'ff00::/8', label: 'マルチキャスト', rfc: 'RFC 4291' },
];

const specialRanges6 = SPECIALS6.map((s) => {
  const { ip, prefix } = parseNetwork6(s.cidr);
  return { ...s, prefix, start: ip, end: ip + (1n << BigInt(128 - prefix)) - 1n };
});

/** 範囲の種別。最も細かい特別な範囲、どれにも当たらなければ「未割り当て・予約」 */
export function kindOf6(start: bigint, end: bigint = start): { kinds: { label: string; rfc?: string; cidr?: string }[]; partial: boolean } {
  const toKind = (r: (typeof specialRanges6)[number]) => ({ label: r.label, rfc: r.rfc, cidr: r.cidr });
  const inside = specialRanges6.filter((r) => r.start <= start && end <= r.end).sort((a, b) => b.prefix - a.prefix);
  const [narrowest] = inside;
  if (narrowest) return { kinds: [toKind(narrowest)], partial: false };
  const overlapping = specialRanges6.filter((r) => r.start <= end && start <= r.end);
  if (overlapping.length === 0) return { kinds: [{ label: '未割り当て・予約（IETF）' }], partial: false };
  return { kinds: overlapping.map(toKind), partial: true };
}

/** 一覧（重複チェック・分割・集約） */

export type Block6 = RangeBlock<bigint>;

/** IPv6 の CIDR を1行ずつ読む（IPv4 の行は読み飛ばす）。行の残りは名前、# の後ろはコメント */
export const parseCidrList6 = (text: string): ParsedCidrList<bigint> => parseCidrListIn(IPV6, text);

/** newPrefix の大きさに均等に分ける（先頭から MAX_ROWS 件まで） */
export const splitNetwork6 = (network: bigint, prefix: number, newPrefix: number): { count: bigint; subnets: bigint[] } =>
  splitNetworkIn(IPV6, network, prefix, newPrefix, MAX_ROWS);

/** IPv6 の均等分割の全件コピー・保存用のテキスト。膨大な列挙は共通の件数上限で拒否する。 */
export const splitNetworkOutput6 = (network: bigint, prefix: number, newPrefix: number): string =>
  splitNetworkOutputIn(IPV6, network, prefix, newPrefix);

/** 開始〜終了の範囲を、それをちょうど覆う最小個数の CIDR にする */
export const rangeToCidrs6 = (start: bigint, end: bigint): { network: bigint; prefix: number }[] => rangeToCidrsIn(IPV6, start, end);

/** IPv6 の CIDR・範囲・アドレスの一覧（IPv4 の行は読み飛ばす）を、最小個数の CIDR にまとめる */
export const aggregate6 = (text: string, outputBudget?: number): Aggregated<bigint> => aggregateIn(IPV6, text, outputBudget);

/** IPv6 のアドレスの種類としての違い（範囲と CIDR の共通の計算 ranges.ts に渡す） */
const IPV6: Family<bigint> = {
  bits: 128,
  zero: 0n,
  one: 1n,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  pow2: (n) => 1n << BigInt(n),
  aligned: (a, n) => a % (1n << BigInt(n)) === 0n,
  readAddress: readIpv6,
  readRange: (text) => {
    const parsed = readNetwork6(text);
    if (isFailure(parsed)) return parsed;
    const { ip, prefix } = parsed;
    const info = subnetInfo6(ip, prefix);
    return { ip, prefix, first: info.network, last: info.last };
  },
  format: formatIpv6,
  splitRange: (text) => splitAddressRange(text, true),
  accepts: isIpv6Text,
  cidrExample: '2001:db8::/32',
  notAlignedWarning: (cidr, normalized) => `${cidr} はプレフィックスの先頭ではないため、${normalized} として扱いました`,
};
