import { Suspense, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToolNameContext } from '../components/ToolShell';
import { findTool } from '../registry';
import type { ToolId } from '../toolCatalog';

export function ToolPage({ onOpen, favorites, onToggleFavorite }: { onOpen: (id: ToolId) => void; favorites: readonly ToolId[]; onToggleFavorite: (id: ToolId) => void }) {
  const { id } = useParams();
  const tool = findTool(id);

  useEffect(() => {
    if (tool) {
      onOpen(tool.id);
      document.title = `${tool.name} | Dev Toolbox`;
    }
    return () => {
      document.title = 'Dev Toolbox';
    };
  }, [tool, onOpen]);

  if (!tool) {
    return (
      <section className="tool-header">
        <h1>ツールが見つかりません</h1>
        <p>
          <Link to="/">トップに戻る</Link>
        </p>
      </section>
    );
  }

  const Tool = tool.component;
  const favorite = favorites.includes(tool.id);
  /** key でツールごとに作り直し、別のツールへ移ればエラー表示が消えるようにする */
  return (
    <>
      <button type="button" className="favorite-toggle" aria-pressed={favorite} onClick={() => onToggleFavorite(tool.id)}>
        <span aria-hidden="true">{favorite ? '★' : '☆'}</span> お気に入り
      </button>
      <ErrorBoundary key={tool.id}>
        <Suspense fallback={<p className="muted">読み込み中…</p>}>
          <ToolNameContext value={tool.name}>
            <Tool />
          </ToolNameContext>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
