import { errorMessage } from '../../lib/errors';
import { detailPreview, limitMessage } from '../../lib/text/textPreview';
import { aggregate, formatIpv4, parseCidrList, parseNetwork, splitNetworkOutput, subnetInfo } from './ipv4';
import { allocateVlsm, parseHostRequests } from './vlsm';
import { findOverlaps, MAX_OVERLAPS, MAX_ROWS, type ListError } from './ranges';
import { aggregate6, isIpv6Text, onlyLines, parseCidrList6, parseNetwork6, splitNetworkOutput6, subnetInfo6 } from './ipv6';
import { formatNumber } from '../../lib/number';

export const MAX_MESSAGES = 20;
export const MAX_AGGREGATE_OUTPUT = 32_000_000;
export const MAX_VLSM_OUTPUT = 10_000_000;

/** 表示の件数制限と独立した均等分割の全件出力。大きな文字列の生成は Worker 内で行う。 */
export function calculateSplit(input: string, newPrefix: number): { output: string } {
  if (isIpv6Text(input)) {
    const { ip, prefix } = parseNetwork6(input);
    return { output: splitNetworkOutput6(subnetInfo6(ip, prefix).network, prefix, newPrefix) };
  }
  const { ip, prefix } = parseNetwork(input);
  return { output: splitNetworkOutput(subnetInfo(ip, prefix).network, prefix, newPrefix) };
}
/**
 * 入力の値（名前・ラベル）は、長い1行を結果として描画しないよう detailPreview で抜粋にする。
 * 診断文は、作る側で入力を抜粋にしてあるため、文言の上限（limitMessage）だけをかける。
 * 診断文全体を抜粋の上限で切り直すと、抜粋した入力の後ろにある理由が消える
 */

function firstMessages(messages: ListError[]) {
  return {
    items: messages.sort((a, b) => a.line - b.line).slice(0, MAX_MESSAGES)
      .map(({ line, message }) => ({ line, message: limitMessage(message) })),
    total: messages.length,
  };
}

/** VLSM の表示には先頭の行だけを返し、コピーには入力順の割り当てをすべて返す。 */
export function calculateVlsm(text: string, network: number, prefix: number, cloud: boolean) {
  const { requests, errors } = parseHostRequests(text);
  const diagnostics = firstMessages(errors);
  let allocations: ReturnType<typeof allocateVlsm>;
  try {
    allocations = allocateVlsm(network, prefix, requests, cloud);
  } catch (error) {
    return { errors: diagnostics, error: limitMessage(errorMessage(error)), count: 0, rows: [], output: '' };
  }
  const lines: string[] = [];
  let outputLength = 0;
  for (const allocation of allocations) {
    const line = `${formatIpv4(allocation.network)}/${allocation.prefix} ${allocation.name}`;
    outputLength += line.length + (lines.length === 0 ? 0 : 1);
    if (outputLength > MAX_VLSM_OUTPUT) {
      throw new Error('割り当て結果が大きすぎます。入力を分割してください。');
    }
    lines.push(line);
  }
  return {
    errors: diagnostics,
    error: '',
    count: allocations.length,
    rows: allocations.slice(0, MAX_ROWS).map((allocation) => ({ ...allocation, name: detailPreview(allocation.name) })),
    output: lines.join('\n'),
  };
}

/** 集約結果の全文をコピー用にまとめ、プレビューとメッセージの表示量を制限する。 */
export function aggregateList(text: string) {
  const v4 = aggregate(onlyLines(text, false));
  const v6 = aggregate6(text);
  const cidrs = [...v4.cidrs, ...v6.cidrs];
  const outputLength = cidrs.reduce((length, cidr) => length + cidr.length + 1, -1);
  if (outputLength > MAX_AGGREGATE_OUTPUT) {
    throw new Error('集約結果が大きすぎます。入力を分割してください（出力上限は半角' + formatNumber(MAX_AGGREGATE_OUTPUT / 10_000) + '万文字相当）。');
  }
  const output = cidrs.join('\n');
  return {
    count: cidrs.length,
    addresses4: v4.addresses,
    addresses6: v6.cidrs.length ? v6.addresses : null,
    errors: firstMessages([...v4.errors, ...v6.errors]),
    output,
  };
}

function overlapEntry({ text, label, line }: { text: string; label: string; line: number }) {
  return { text: detailPreview(text), label: detailPreview(label), line };
}

/** IPv4 と IPv6 を別々に検査し、件数と表示に必要な項目だけを返す。 */
export function checkOverlapList(text: string) {
  const v4 = parseCidrList(onlyLines(text, false));
  const v6 = parseCidrList6(text);
  const o4 = findOverlaps(v4.blocks);
  const o6 = findOverlaps(v6.blocks);
  return {
    count: v4.blocks.length + v6.blocks.length,
    errors: firstMessages([...v4.errors, ...v6.errors]),
    warnings: firstMessages([...v4.warnings, ...v6.warnings]),
    overlaps: [...o4.overlaps, ...o6.overlaps].slice(0, MAX_OVERLAPS).map(({ a, b, kind }) => ({
      a: overlapEntry(a), b: overlapEntry(b), kind,
    })),
    truncated: o4.truncated || o6.truncated || o4.overlaps.length + o6.overlaps.length > MAX_OVERLAPS,
  };
}
