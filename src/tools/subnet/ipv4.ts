/**
 * IPv4 のアドレス・サブネットの計算。
 * アドレスは 0 〜 2^32-1 の数（Number）で持つ。ビット演算は32ビットの符号付きになるため、結果は \>\>\> 0 で符号なしに戻す。
 */
import { isIpv6Text, splitAddressRange } from './addressRange';
import { CLOUD_RESERVED, cloudSubnetNotes } from './cloudPolicy';
import { detailPreview } from '../../lib/text/textPreview';
import { aggregateIn, isFailure, MAX_ROWS, parseCidrListIn, rangeToCidrsIn, splitNetworkIn, splitNetworkOutputIn, type Aggregated, type Failure, type Family, type ParsedCidrList, type RangeBlock } from './ranges';

/** 例外を投げずに parseIpv4 と同じ規則で読む。読めなければ、理由の文言で例外を投げる関数を返す（一覧の読み取り用） */
export function readIpv4(input: string): number | Failure {
  const s = input.trim();
  const parts = s.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) {
    return () => { throw new Error(`「${detailPreview(s)}」は IPv4 アドレスの形式（192.168.0.1 など）ではありません`); };
  }
  if (parts.some((p) => p.length > 1 && p[0] === '0')) {
    return () => { throw new Error(`「${detailPreview(s)}」の先頭の0は付けないでください（8進数として読む実装があり、意味が変わるため）`); };
  }
  const octets = parts.map(Number);
  if (octets.some((o) => o > 255)) return () => { throw new Error(`「${detailPreview(s)}」の各部は 0〜255 で指定してください`); };
  /** 4つの部分があることは上で確かめている（既定値は型のためだけ） */
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** 「192.168.10.1」を数にする。各部は 0〜255 の10進数。先頭の0（8進数と解釈する実装がある）は受け付けない */
export function parseIpv4(input: string): number {
  const result = readIpv4(input);
  return isFailure(result) ? result() : result;
}

export const formatIpv4 = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/** プレフィックス長（0〜32）のサブネットマスク */
const maskOf = (prefix: number): number => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

/** 上位から1が続き、残りが0のマスクなら、そのプレフィックス長。そうでなければ null */
function prefixOfMask(mask: number): number | null {
  for (let p = 0; p <= 32; p++) if (maskOf(p) === mask) return p;
  return null;
}

/** 32桁の2進数（8桁ごとに . で区切る） */
export const binaryOf = (n: number): string =>
  n
    .toString(2)
    .padStart(32, '0')
    .replace(/(.{8})(?!$)/g, '$1.');

export type ParsedNetwork = {
  ip: number;
  prefix: number;
  /** どの書き方で指定されたか */
  notation: 'cidr' | 'mask' | 'wildcard' | 'host';
};

/**
 * 「192.168.10.0/24」「10.0.0.5 255.255.255.0」「10.0.0.5/255.255.255.0」「10.0.0.0 0.0.0.255」（ワイルドカードマスク）、
 * またはアドレスだけ（/32）を読む。
 * マスクとワイルドカードマスクのどちらとも読める値（0.0.0.0・255.255.255.255）は、サブネットマスクとして読む
 */
export function parseNetwork(input: string): ParsedNetwork {
  const result = readNetwork(input);
  return isFailure(result) ? result() : result;
}

/** 例外を投げずに parseNetwork と同じ規則で読む。読めなければ、理由の文言で例外を投げる関数を返す（一覧の読み取り用） */
function readNetwork(input: string): ParsedNetwork | Failure {
  const s = input.trim();
  if (!s) return () => { throw new Error('アドレスを入力してください'); };
  const m = /^([\d.]+)(?:\s*\/\s*|\s+)(\S+)$/.exec(s);
  if (!m) {
    const ip = readIpv4(s);
    return isFailure(ip) ? ip : { ip, prefix: 32, notation: 'host' };
  }
  const [, ipText = '', second = ''] = m;
  const ip = readIpv4(ipText);
  if (isFailure(ip)) return ip;
  if (/^\d{1,2}$/.test(second)) {
    const prefix = Number(second);
    if (prefix > 32) return () => { throw new Error('プレフィックス長は 0〜32 で指定してください'); };
    return { ip, prefix, notation: 'cidr' };
  }
  const value = readIpv4(second);
  if (isFailure(value)) return value;
  const asMask = prefixOfMask(value);
  if (asMask !== null) return { ip, prefix: asMask, notation: 'mask' };
  const asWildcard = prefixOfMask(~value >>> 0);
  if (asWildcard !== null) return { ip, prefix: asWildcard, notation: 'wildcard' };
  return () => { throw new Error(`「${detailPreview(second)}」はサブネットマスクとしてもワイルドカードマスクとしても使えません（1 と 0 が途中で入れ替わっています）`); };
}

/** アドレスの種別 */

type Special = { network: string; prefix: number; label: string; rfc?: string };

/** 特別な用途のアドレス（IANA IPv4 Special-Purpose Address Registry などから、よく使うもの） */
const SPECIALS: Special[] = [
  { network: '0.0.0.0', prefix: 8, label: 'このネットワーク', rfc: 'RFC 1122' },
  { network: '10.0.0.0', prefix: 8, label: 'プライベート', rfc: 'RFC 1918' },
  { network: '100.64.0.0', prefix: 10, label: 'CGNAT（キャリアグレードNAT）の共有アドレス', rfc: 'RFC 6598' },
  { network: '127.0.0.0', prefix: 8, label: 'ループバック', rfc: 'RFC 1122' },
  { network: '169.254.0.0', prefix: 16, label: 'リンクローカル', rfc: 'RFC 3927' },
  { network: '172.16.0.0', prefix: 12, label: 'プライベート', rfc: 'RFC 1918' },
  { network: '192.0.0.0', prefix: 24, label: 'IETF のプロトコル用', rfc: 'RFC 6890' },
  { network: '192.0.2.0', prefix: 24, label: 'ドキュメント用（TEST-NET-1）', rfc: 'RFC 5737' },
  { network: '192.88.99.0', prefix: 24, label: '6to4 リレー（廃止）', rfc: 'RFC 7526' },
  { network: '192.168.0.0', prefix: 16, label: 'プライベート', rfc: 'RFC 1918' },
  { network: '198.18.0.0', prefix: 15, label: 'ベンチマーク用', rfc: 'RFC 2544' },
  { network: '198.51.100.0', prefix: 24, label: 'ドキュメント用（TEST-NET-2）', rfc: 'RFC 5737' },
  { network: '203.0.113.0', prefix: 24, label: 'ドキュメント用（TEST-NET-3）', rfc: 'RFC 5737' },
  { network: '224.0.0.0', prefix: 4, label: 'マルチキャスト', rfc: 'RFC 5771' },
  { network: '240.0.0.0', prefix: 4, label: '予約（将来の利用）', rfc: 'RFC 1112' },
  { network: '255.255.255.255', prefix: 32, label: 'ブロードキャスト（限定）', rfc: 'RFC 919' },
];

const specialRanges = SPECIALS.map((s) => {
  const start = parseIpv4(s.network);
  return { ...s, start, end: start + 2 ** (32 - s.prefix) - 1 };
});

export type AddressKind = { label: string; rfc?: string; cidr?: string };

/**
 * 範囲（start〜end）の種別。全体が1つの特別な範囲に収まればその種別（最も細かいもの）、
 * どれとも重ならなければ「グローバル」、一部だけ重なれば重なる種別を並べる
 */
export function kindOf(start: number, end: number = start): { kinds: AddressKind[]; partial: boolean } {
  const toKind = (r: (typeof specialRanges)[number]) => ({ label: r.label, rfc: r.rfc, cidr: `${r.network}/${r.prefix}` });
  const inside = specialRanges.filter((r) => r.start <= start && end <= r.end).sort((a, b) => b.prefix - a.prefix);
  const [narrowest] = inside;
  if (narrowest) return { kinds: [toKind(narrowest)], partial: false };
  const overlapping = specialRanges.filter((r) => r.start <= end && start <= r.end);
  if (overlapping.length === 0) return { kinds: [{ label: 'グローバル（パブリック）' }], partial: false };
  return { kinds: overlapping.map(toKind), partial: true };
}

/** サブネットの計算 */

export type SubnetInfo = {
  network: number;
  broadcast: number;
  prefix: number;
  mask: number;
  wildcard: number;
  /** アドレスの総数 */
  total: number;
  /** 利用できるホストの数 */
  usable: number;
  /** 利用できる範囲（なければ null） */
  first: number | null;
  last: number | null;
  /** /31・/32・クラウドの予約などの説明 */
  notes: string[];
};

/**
 * サブネットの情報。
 * - /31 は2アドレスとも使える（RFC 3021。ポイントツーポイント接続用で、ネットワーク・ブロードキャストアドレスがない）
 * - /32 は1アドレス（ホストルートなど）
 * - cloud のときは、AWS・Azure と同じく先頭4つ（ネットワーク・ルーター・DNS・将来用）と末尾（ブロードキャスト）の5つを除く
 */
export function subnetInfo(ip: number, prefix: number, cloud = false): SubnetInfo {
  const mask = maskOf(prefix);
  const network = (ip & mask) >>> 0;
  const total = 2 ** (32 - prefix);
  const broadcast = network + total - 1;
  const notes: string[] = [];
  let first: number | null;
  let last: number | null;

  if (cloud) {
    first = total > CLOUD_RESERVED ? network + 4 : null;
    last = total > CLOUD_RESERVED ? broadcast - 1 : null;
    notes.push(...cloudSubnetNotes(4, prefix));
  } else if (prefix === 32) {
    first = last = network;
    notes.push('/32 は1アドレスだけを表します（ホストルートなど）');
  } else if (prefix === 31) {
    first = network;
    last = broadcast;
    notes.push('/31 はネットワークアドレス・ブロードキャストアドレスがなく、2アドレスとも使えます（RFC 3021。機器間の接続用）');
  } else {
    first = network + 1;
    last = broadcast - 1;
  }

  return {
    network,
    broadcast,
    prefix,
    mask,
    wildcard: ~mask >>> 0,
    total,
    usable: first === null || last === null ? 0 : last - first + 1,
    first,
    last,
    notes,
  };
}

/** ip がネットワーク（network/prefix）に含まれるか */
export const contains = (network: number, prefix: number, ip: number): boolean => ((ip & maskOf(prefix)) >>> 0) === network;

/** 一覧の読み取り */

export type Block = RangeBlock<number>;

/**
 * 1行に1つずつ書いた CIDR を読む。行の残りは名前（「10.0.0.0/16 本番VPC」）、# の後ろはコメント。
 * ネットワークアドレスでない値（192.168.1.5/24）は、ネットワーク（192.168.1.0/24）に直して読み、warnings に入れる
 */
export const parseCidrList = (text: string): ParsedCidrList<number> => parseCidrListIn(IPV4, text);

/** 分割 */

/** ネットワークを newPrefix の大きさに均等に分ける（先頭から MAX_ROWS 件まで） */
export const splitNetwork = (network: number, prefix: number, newPrefix: number): { count: number; subnets: number[] } =>
  splitNetworkIn(IPV4, network, prefix, newPrefix, MAX_ROWS);

/** 均等分割した全件を出力する（表示の MAX_ROWS とは別の出力上限を適用する）。 */
export const splitNetworkOutput = (network: number, prefix: number, newPrefix: number): string =>
  splitNetworkOutputIn(IPV4, network, prefix, newPrefix);

/** 集約・範囲変換 */

/** 開始〜終了のアドレス範囲を、それをちょうど覆う最小個数の CIDR にする */
export const rangeToCidrs = (start: number, end: number): { network: number; prefix: number }[] => rangeToCidrsIn(IPV4, start, end);

/**
 * CIDR・アドレスの範囲（「10.0.0.0 - 10.0.0.255」）・アドレスを1行ずつ書いた一覧を、
 * 重なりや隣り合う範囲をまとめた最小個数の CIDR にする（outputBudget は ranges.ts の aggregateIn）
 */
export const aggregate = (text: string, outputBudget?: number): Aggregated<number> => aggregateIn(IPV4, text, outputBudget);

/** IPv4 のアドレスの種類としての違い（範囲と CIDR の共通の計算 ranges.ts に渡す） */
const IPV4: Family<number> = {
  bits: 32,
  zero: 0,
  one: 1,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  pow2: (n) => 2 ** n,
  aligned: (a, n) => a % 2 ** n === 0,
  readAddress: readIpv4,
  readRange: (text) => {
    const parsed = readNetwork(text);
    if (isFailure(parsed)) return parsed;
    const { ip, prefix } = parsed;
    const info = subnetInfo(ip, prefix);
    return { ip, prefix, first: info.network, last: info.broadcast };
  },
  format: formatIpv4,
  splitRange: (text) => splitAddressRange(text, false),
  /** IPv6 の行（先頭の値に : がある行）は ipv6.ts が読むので、それ以外の行を読む */
  accepts: (line) => !isIpv6Text(line),
  cidrExample: '10.0.0.0/16',
  notAlignedWarning: (cidr, normalized) => `${cidr} はネットワークアドレスではないため、${normalized} として扱いました`,
};
