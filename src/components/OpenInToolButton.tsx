import { useNavigate } from 'react-router-dom';
import { handOff } from '../lib/handoff';
import { formatNumber } from '../lib/number';
import { toolCatalog, type ToolId } from '../toolCatalog';

/**
 * 結果を、別のツールの入力として開くボタン（「JSON整形で開く」など）。値はタブ内のメモリだけで渡す（src/lib/handoff.ts）。
 *
 * @param to - 開くツール。受け取る側は、画面を開いたときに takeHandoff で受け取る。
 * @param text - 渡す値。空なら押せない。
 * @param limit - 開くツールの入力の上限。超えるときは押せない（開いた先でエラーになるため）。
 */
export function OpenInToolButton({ to, text, limit }: { to: ToolId; text: string; limit?: number }) {
  const navigate = useNavigate();
  const name = toolCatalog.find((tool) => tool.id === to)?.name ?? to;
  const tooLarge = limit !== undefined && text.length > limit;
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={!text || tooLarge}
      title={tooLarge && limit !== undefined ? `${name}の入力の上限（${formatNumber(limit)}文字）を超えています` : undefined}
      onClick={() => {
        handOff(to, text);
        navigate(`/${to}`);
      }}
    >
      {name}で開く
    </button>
  );
}
