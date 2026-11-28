import { Link } from 'react-router-dom';
import { toolsByCategory, type ToolDef } from '../registry';
import { SEARCH_SHORTCUT } from './platform';

function ToolChips({ title, tools }: { title: string; tools: ToolDef[] }) {
  if (tools.length === 0) return null;
  return (
    <>
      <h2 className="section-title">{title}</h2>
      <div className="chips">
        {tools.map((t) => (
          <Link key={t.id} to={`/${t.id}`} className="chip">
            {t.name}
          </Link>
        ))}
      </div>
    </>
  );
}

export function Home({ recent, favorites }: { recent: ToolDef[]; favorites: ToolDef[] }) {
  return (
    <section>
      <header className="tool-header">
        <h1>開発者向けユーティリティ</h1>
        <p>よく使う変換・確認作業をブラウザだけで。{SEARCH_SHORTCUT} でいつでも検索できます。</p>
      </header>
      <ToolChips title="お気に入り" tools={favorites} />
      <ToolChips title="最近使ったツール" tools={recent} />
      {toolsByCategory().map(({ category, tools }) => (
        <div key={category}>
          <h2 className="section-title">{category}</h2>
          <div className="grid">
            {tools.map((t) => (
              <Link key={t.id} to={`/${t.id}`} className="card">
                <span className="card-title">{t.name}</span>
                <span className="card-desc">{t.description}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
