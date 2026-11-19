/**
 * 範囲の両端を字句として分ける。値の検証は各アドレスのパーサーで行う。
 * IPv6 の最後の : からアドレス本体の先頭へ戻り、その直前だけを区切りとして見る。
 * ゾーンID内の -・~ はアドレス本体の外なので区切らない。入力長に比例する時間で終える。
 */
export function splitAddressRange(text: string, ipv6: boolean): readonly [string, string] | null {
  if (!ipv6) {
    const match = /^([^\s~〜–-]+)\s*(?:-|–|〜|~)\s*([^\s~〜–-]+)$/.exec(text);
    return match ? [match[1] ?? '', match[2] ?? ''] : null;
  }
  let start = text.lastIndexOf(':');
  if (start < 0) return null;
  while (start > 0 && /[0-9a-fA-F:.\[\]]/.test(text.charAt(start - 1))) start--;
  let separator = start - 1;
  while (separator >= 0 && /\s/.test(text.charAt(separator))) separator--;
  if (separator < 0 || !'-–〜~'.includes(text.charAt(separator))) return null;
  return [text.slice(0, separator).trim(), text.slice(start).trim()];
}
