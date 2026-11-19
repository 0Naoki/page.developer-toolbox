import { sortedEntries, type JsonNode } from '../../lib/jsonTree';

/**
 * ツリー表示の計算（画面に依存しない部分）。
 *
 * @remarks
 * 構文木は src/lib/jsonTree.ts の parseJsonTree で作る（数値・文字列・重複キーを元の表記のまま持つ）。
 * 画面の側で解析するため、入力の大きさを {@link MAX_TREE_INPUT} までに限る。
 */

/**
 * ツリーを表示する入力の上限（UTF-16 の単位）。解析は画面の側（Worker の外）で行うため、遅い端末でも止まらない大きさにする
 * （手元の計測で、100万単位の解析は約0.05秒）。整形の上限（計算 Worker の上限）より小さい
 */
export const MAX_TREE_INPUT = 1_000_000;

/** 1回に表示する子の数。残りは「さらに表示」で足す */
export const TREE_CHILD_PAGE = 100;

/** 識別子として書けるキー（`.name` の形にできる）。それ以外は `["name"]` の形にする */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * 子の値の場所を、JSONPath の形（`$.user.roles[0]`・`$["first name"]`）で組み立てる。
 *
 * @param parent - 親の場所（根は `$`）。
 * @param step - オブジェクトのキー（デコードした名前）、または配列の添字。
 */
export function childPath(parent: string, step: { name: string } | { index: number }): string {
  if ('index' in step) return `${parent}[${step.index}]`;
  return IDENTIFIER.test(step.name) ? `${parent}.${step.name}` : `${parent}[${JSON.stringify(step.name)}]`;
}

/** ツリーの1つの子（表示の名前・場所・値） */
export type TreeChild = { label: string; path: string; node: JsonNode };

/** ソートしたキーの並び。「さらに表示」のたびにソートし直さないよう、オブジェクトごとに覚える */
const sortedCache = new WeakMap<JsonNode, ReturnType<typeof sortedEntries>>();

function entriesOf(node: Extract<JsonNode, { kind: 'object' }>, sortKeys: boolean): ReturnType<typeof sortedEntries> {
  if (!sortKeys) return node.entries;
  let sorted = sortedCache.get(node);
  if (!sorted) {
    sorted = sortedEntries(node);
    sortedCache.set(node, sorted);
  }
  return sorted;
}

/**
 * 子を、先頭から limit 件だけ返す（ソートしないときは、全件の配列を作らない）。total は子の総数。
 *
 * @param node - 親の値。値（数値・文字列など）は子を持たない。
 * @param path - 親の場所。
 * @param limit - 返す子の数。
 * @param sortKeys - 「キーをソート」。整形の出力と同じ並びにする。
 */
export function childrenOf(node: JsonNode, path: string, limit: number, sortKeys = false): { children: TreeChild[]; total: number } {
  if (node.kind === 'object') {
    return {
      children: entriesOf(node, sortKeys).slice(0, limit).map((e) => ({ label: e.name, path: childPath(path, { name: e.name }), node: e.value })),
      total: node.entries.length,
    };
  }
  if (node.kind === 'array') {
    return {
      children: node.items.slice(0, limit).map((item, index) => ({ label: `[${index}]`, path: childPath(path, { index }), node: item })),
      total: node.items.length,
    };
  }
  return { children: [], total: 0 };
}
