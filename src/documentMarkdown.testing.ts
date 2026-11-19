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

/** 文言の変更や箇条書きへの分割に影響されない、明示した開始・終了マーカーの本文。 */
export function markedSection(text: string, name: string): string {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  if (text.split(start).length !== 2 || text.split(end).length !== 2) throw new Error(`マーカー「${name}」が欠けているか重複しています`);
  const from = text.indexOf(start) + start.length;
  const to = text.indexOf(end);
  if (to < from) throw new Error(`マーカー「${name}」の順序が逆です`);
  return text.slice(from, to);
}

/** 上限の説明から数値・範囲・単位だけを読む。前後の日本語の言い回しは検査しない。 */
export function limitTokens(text: string): string[] {
  return text.match(/[±+-]?\d[\d,]*(?:\.\d+)?(?:万)?(?:〜[±+-]?\d[\d,]*(?:\.\d+)?(?:万)?)?\s*(?:MiB|KiB|MB|バイト|単位|セル|件|秒|年|月|営業日|日|個|種類|文字|桁|行|組|ブロック|マッチ)?/g)?.map((s) => s.trim()) ?? [];
}

/** 上限の意味を表す固定IDと、実装の定数から作った数値・単位の表記。 */
export type DocumentLimit = { id: string; expected: string };
export type DocumentLimits = Record<string, readonly [readonly DocumentLimit[], readonly DocumentLimit[], readonly DocumentLimit[]]>;

/** 言い回しに依存せず、ツール・列・上限IDに対応する値を照合する。値の入れ替えも検出する。 */
export function documentLimitIssues(markdown: string, limits: DocumentLimits): string[] {
  const rows = new Map(markdown.split('\n').filter((line) => line.startsWith('| ') && line.includes('<!-- limit:')).map((line) => {
    const [, tool = '', ...cells] = line.split('|').map((cell) => cell.trim());
    return [tool, cells] as const;
  }));
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const [tool, columns] of Object.entries(limits)) {
    for (const [column, fields] of columns.entries()) for (const field of fields) {
      if (ids.has(field.id)) issues.push(`上限IDが重複しています：${field.id}`);
      ids.add(field.id);
      try {
        const actual = markedSection(rows.get(tool)?.[column] ?? '', `limit:${field.id}`);
        if (JSON.stringify(limitTokens(actual)) !== JSON.stringify(limitTokens(field.expected))) issues.push(`${tool}：${field.id} の値・単位が違います`);
      } catch {
        issues.push(`${tool}：列${column + 1}の上限ID ${field.id} が欠けているか重複しています`);
      }
    }
  }
  const actualIds = [...markdown.matchAll(/<!-- limit:([a-z0-9.-]+):start -->/g)].map((m) => m[1] ?? '');
  if (actualIds.length !== ids.size || actualIds.some((id) => !ids.has(id))) issues.push('上限IDの一覧が実装の検査項目と一致しません');
  return issues;
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
