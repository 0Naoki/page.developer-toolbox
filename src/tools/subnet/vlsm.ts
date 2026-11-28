/**
 * IPv4 のサブネットの、必要なホスト数に合わせた割り当て（VLSM）。
 * IPv6 のサブネットは /64 で割り当てるのが一般的なため、IPv4 だけに対応する。
 */
import { CLOUD_RESERVED } from './cloudPolicy';
import { detailPreview } from '../../lib/text/textPreview';
import { splitLines } from '../../lib/text/lines';
import { formatNumber } from '../../lib/number';
import { formatIpv4 } from './ipv4';
import { messageList, type ListError } from './ranges';

export type HostRequest = { line: number; name: string; hosts: number };
export type Allocation = HostRequest & { network: number; prefix: number };
/** 大量の短い行でも、解析時に作る行と割り当ての数を制限する。 */
export const MAX_VLSM_LINES = 250_000;

/**
 * 「営業部 120」のように、名前と必要なホスト数を1行ずつ書いた一覧を読む（名前は省略できる）。
 * ホスト数は行末の空白区切りの値全体。末尾の数字だけを読むと、「-120」「1.5」「1,500」が別の数として割り当てられる。
 * errors は行の順で先頭 MAX_LIST_MESSAGES 件、errorTotal は読めない行の総数。読めない行が大量でも、全件のエラーを作らない
 */
export function parseHostRequests(text: string): { requests: HostRequest[]; errors: ListError[]; errorTotal: number } {
  const requests: HostRequest[] = [];
  const errors = messageList();
  const lines = splitLines(text, MAX_VLSM_LINES + 2);
  /** 最後の改行だけで空の行が1つ加わった場合は数えない。 */
  if (lines.length > MAX_VLSM_LINES + 1 || (lines.length > MAX_VLSM_LINES && lines.at(-1) !== '')) {
    throw new Error(`ホスト数の一覧は ${formatNumber(MAX_VLSM_LINES)} 行までです。入力を分割してください。`);
  }
  lines.forEach((raw, i) => {
    const body = raw.replace(/#.*/, '').trim();
    if (!body) return;
    const count = body.split(/\s+/).at(-1)!;
    const hosts = Number(count);
    if (!/^\d+$/.test(count) || hosts < 1 || !Number.isSafeInteger(hosts)) {
      errors.add(i + 1, () => HOSTS_FORMAT);
      return;
    }
    const name = body.slice(0, body.length - count.length).trimEnd();
    requests.push({ line: i + 1, name: name || `サブネット${requests.length + 1}`, hosts });
  });
  return { requests, errors: errors.items, errorTotal: errors.total() };
}

const HOSTS_FORMAT = '「営業部 120」のように、名前と必要なホスト数（1以上の整数）を空白で区切って書いてください';

/**
 * 必要なホスト数を満たす最小のサブネットのプレフィックス長。
 * /31・/32 は使わない。クラウドなら予約の5つを足し、AWS で作れる最小の /28 より小さくしない
 */
export function prefixForHosts(hosts: number, cloud = false): number {
  const reserved = cloud ? CLOUD_RESERVED : 2;
  for (let p = cloud ? 28 : 30; p >= 0; p--) if (2 ** (32 - p) - reserved >= hosts) return p;
  throw new Error(`${formatNumber(hosts)} ホストを収められるサブネットはありません`);
}

/**
 * 必要なホスト数に合わせて、大きいものから順に割り当てる（VLSM）。
 * 大きい順に並べて先頭から詰めると、どのサブネットも自分の大きさの境界にそろう
 */
export function allocateVlsm(network: number, prefix: number, requests: HostRequest[], cloud = false): Allocation[] {
  const sized = requests.map((r) => ({ ...r, prefix: prefixForHosts(r.hosts, cloud) }));
  const order = [...sized].sort((a, b) => a.prefix - b.prefix || a.line - b.line);
  const end = network + 2 ** (32 - prefix);
  let next = network;
  const result = new Map<number, Allocation>();
  for (const r of order) {
    const size = 2 ** (32 - r.prefix);
    if (r.prefix < prefix || next + size > end) {
      throw new Error(`${formatIpv4(network)}/${prefix} に収まりません（「${detailPreview(r.name)}」の /${r.prefix} を割り当てられません）`);
    }
    result.set(r.line, { ...r, network: next });
    next += size;
  }
  return sized.map((r) => result.get(r.line)!);
}
