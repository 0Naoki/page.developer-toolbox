/**
 * GitHub が見出しに付けるアンカー。
 *
 * @remarks
 * 小文字にし、文字・数字・下線・空白・ハイフン以外（全角の括弧や「・」を含む）を除き、空白をハイフンにする。
 * 同じ見出しが複数あるときの「-1」などの連番にも対応する。
 */
export function headingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const heading = (m[1] ?? '').replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const base = heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/** 数値を含む説明を照合し、別の数値の一部分との一致を除く。 */
export function containsLimit(cell: string, limit: string): boolean {
  const escaped = limit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = /^\d/.test(limit) ? '(?<![0-9,.])' : '';
  const end = /\d$/.test(limit) ? '(?![0-9,.])' : '';
  return new RegExp(start + escaped + end).test(cell);
}

/**
 * 見出し（「## 既知不具合を守るテスト」など）から、同じ階層か上の階層の次の見出しの前までの本文。
 * 文書のほかの節の表を、検査の対象と取り違えないために使う。
 *
 * @throws 見出しがないとき（見出しの名前を変えたときに、検査が空の本文で素通りしないように）。
 */
export function sectionOf(text: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`見出し「${heading}」がありません`);
  let end = start + 1;
  let inFence = false;
  for (; end < lines.length; end++) {
    const line = lines[end] ?? '';
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && /^(#+)\s/.exec(line);
    if (m && (m[1]?.length ?? 0) <= level) break;
  }
  return lines.slice(start, end).join('\n');
}
