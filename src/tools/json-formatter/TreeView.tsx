import { useState } from 'react';
import { ClippedText } from '../../components/ClippedText';
import { CopyButton } from '../../components/CopyButton';
import type { JsonNode } from '../../lib/jsonTree';
import { formatNumber } from '../../lib/number';
import { detailPreview } from '../../lib/text/textPreview';
import { childrenOf, TREE_CHILD_PAGE } from './tree';

/**
 * JSON のツリー表示。子は開いたときに初めて描画し、1回に {@link TREE_CHILD_PAGE} 件までにする（大きな配列でも止まらないように）。
 * 各行で、値の場所（JSONPath の形）と、値（数値・文字列などの元の表記）をコピーできる。
 */
export function TreeView({ root }: { root: JsonNode }) {
  return (
    <ul className="json-tree" aria-label="JSON のツリー">
      <TreeNode label="$" path="$" node={root} initiallyOpen />
    </ul>
  );
}

function TreeNode({ label, path, node, initiallyOpen = false }: { label: string; path: string; node: JsonNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [shown, setShown] = useState(TREE_CHILD_PAGE);
  /** キーは長くできるため、見出しとボタンの名前には抜粋を使う（場所の全文はコピーで取り出す） */
  const name = detailPreview(label);
  const { children, total } = open ? childrenOf(node, path, shown) : { children: [], total: 0 };
  const count = node.kind === 'object' ? node.entries.length : node.kind === 'array' ? node.items.length : 0;
  return (
    <li>
      <div className="json-tree-row">
        {node.kind === 'scalar' ? (
          <span className="json-tree-spacer" aria-hidden="true" />
        ) : (
          <button type="button" className="json-tree-toggle" aria-expanded={open} aria-label={`${name} を${open ? '閉じる' : '開く'}`} onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'}
          </button>
        )}
        <span className="json-tree-key mono">{name}</span>
        {node.kind === 'scalar' ? (
          <span className="json-tree-value mono"><ClippedText text={node.raw} copy={false} /></span>
        ) : (
          <span className="muted">{node.kind === 'object' ? `{ ${formatNumber(count)} 個のキー }` : `[ ${formatNumber(count)} 件 ]`}</span>
        )}
        <span className="json-tree-actions">
          <CopyButton text={path} label="パスをコピー" />
          {node.kind === 'scalar' && <CopyButton text={node.raw} label="値をコピー" />}
        </span>
      </div>
      {open && count > 0 && (
        <ul>
          {/** 重複したキーは同じ場所になるため、key には並びの番号を使う（子の並びは変わらない） */}
          {children.map((child, i) => <TreeNode key={i} label={child.label} path={child.path} node={child.node} />)}
          {total > shown && (
            <li className="json-tree-row">
              <span className="json-tree-spacer" aria-hidden="true" />
              <button type="button" className="btn btn-ghost" onClick={() => setShown(shown + TREE_CHILD_PAGE)}>
                さらに {formatNumber(Math.min(TREE_CHILD_PAGE, total - shown))} 件を表示
              </button>
              <span className="muted">残り {formatNumber(total - shown)} 件</span>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
