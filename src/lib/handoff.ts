import type { ToolId } from '../toolCatalog';

/**
 * ツール間の受け渡し（JWT のペイロードを JSON整形で開く、など）。
 *
 * @remarks
 * 渡す値は、このタブのメモリだけに置く。URL（#/json?text=… など）に載せると、ブラウザの履歴やブックマーク、
 * 画面を共有したときのアドレスバーに機密になり得る値が残るため。保存もしない（再読み込みすると消える）。
 * 受け取る側は、画面を開いたときに1回だけ受け取る（{@link takeHandoff}）。受け取らないまま別の値を渡すと、前の値は捨てる。
 */
let pending: { to: ToolId; text: string } | null = null;

/** 値を、次に開くツールへ渡す（1件だけ持つ） */
export function handOff(to: ToolId, text: string): void {
  pending = { to, text };
}

/**
 * このツールへ渡された値を受け取る。受け取った値は手元から消す（同じ値を2回受け取らない）。
 *
 * @returns 渡された値。このツールへの値がなければ null。
 */
export function takeHandoff(to: ToolId): string | null {
  if (pending?.to !== to) return null;
  const { text } = pending;
  pending = null;
  return text;
}
