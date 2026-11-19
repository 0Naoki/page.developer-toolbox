import type { JsonNode } from '../../lib/jsonTree';
import { detailPreview } from '../../lib/text/textPreview';

/**
 * 列への展開前に、同じオブジェクト内のキーの重複を拒否する。
 * @remarks 配列や展開しないオブジェクトの内側も検査する。別のオブジェクトに同名のキーがあることは許可する。
 * 構文・深さの検証は共通JSONパーサーが担当し、整形ツールの「保持して警告」とは用途を分ける。
 */
export function assertUniqueObjectKeys(node: JsonNode): void {
  if (node.kind === 'array') {
    for (const item of node.items) assertUniqueObjectKeys(item);
  } else if (node.kind === 'object') {
    const seen = new Set<string>();
    for (const { name, value } of node.entries) {
      if (seen.has(name)) throw new Error(`項目名「${detailPreview(name)}」が重複しています（同じオブジェクト内のキーは一意にしてください）`);
      seen.add(name);
      assertUniqueObjectKeys(value);
    }
  }
}
