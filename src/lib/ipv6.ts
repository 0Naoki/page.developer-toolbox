/**
 * IPv6 アドレスの推奨表記（RFC 5952）。サブネット計算（BigInt から）と証明書の別名（バイト列から）で表記をそろえる。
 *
 * @remarks
 * 小文字にし、各グループの先頭の0を省き、2つ以上続く0の最も長い並び（同じ長さなら先頭）を :: にする。
 * IPv4 射影アドレス（::ffff:0:0/96）は末尾を IPv4 の形で書く（RFC 5952 の 5章）。
 *
 * @param groups - 16ビットのグループ8つ（先頭から順に。各 0〜0xffff）
 */
export function formatIpv6Groups(groups: readonly number[]): string {
  if (groups.length !== 8) throw new Error('IPv6 アドレスはグループが8つ必要です');
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return `::ffff:${[high >>> 8, high & 255, low >>> 8, low & 255].join('.')}`;
  }
  let best = { start: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i >= 2 && j - i > best.len) best = { start: i, len: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.start < 0) return hex.join(':');
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.len).join(':')}`;
}
