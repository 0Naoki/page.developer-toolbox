import { Link, NavLink } from 'react-router-dom';
import { PrivacySettings } from './PrivacySettings';
import { Segmented } from '../components/Segmented';
import { toolsByCategory, type ToolDef } from '../registry';
import { focusMainHeading, type useAppNavigation } from './useAppNavigation';
import { SEARCH_SHORTCUT } from './platform';
import type { Theme } from './useTheme';
import { VERSION_LABEL } from '../buildInfo';

/** ツール一覧・検索・テーマ・保存設定を表示する。 */
export function Sidebar({ navigation, favoriteTools, theme, setTheme }: {
  navigation: ReturnType<typeof useAppNavigation>;
  favoriteTools: ToolDef[];
  theme: Theme;
  setTheme: (theme: Theme) => void;
}) {
  const { menuOpen, setMenuOpen, sidebarRef, menuButtonRef, pathname, setPaletteOpen } = navigation;
  const navItem = (t: ToolDef) => (
    <NavLink key={t.id} to={`/${t.id}`} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
      onClick={() => {
        setMenuOpen(false);
        if (pathname === `/${t.id}`) focusMainHeading();
      }}>
      {t.name}
    </NavLink>
  );

  return (
    <aside className="sidebar" ref={sidebarRef}>
      <div className="sidebar-header">
        <Link to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark">{'{}'}</span> Dev Toolbox
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={menuOpen}
          aria-controls="tool-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {menuOpen ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>
      <div id="tool-navigation" className={menuOpen ? 'sidebar-content open' : 'sidebar-content'}>
        <button
          type="button"
          className="search-trigger"
          onClick={(e) => {
            /** Safari はクリックしたボタンにフォーカスを移さないため、閉じたときに戻る先がなくなる。先にフォーカスしておく */
            e.currentTarget.focus();
            setPaletteOpen(true);
          }}
        >
          <span>ツールを検索</span>
          <kbd>{SEARCH_SHORTCUT}</kbd>
        </button>
        <nav className="nav" aria-label="ツール一覧">
          {favoriteTools.length > 0 && (
            <div className="nav-group">
              <div className="nav-heading">お気に入り</div>
              {favoriteTools.map(navItem)}
            </div>
          )}
          {toolsByCategory().map(({ category, tools }) => (
            <div key={category} className="nav-group">
              <div className="nav-heading">{category}</div>
              {tools.map(navItem)}
            </div>
          ))}
        </nav>
        <div className="sidebar-theme">
          <span className="nav-heading">テーマ</span>
          <Segmented<Theme>
            label="テーマ"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: '自動' },
              { value: 'light', label: 'ライト' },
              { value: 'dark', label: 'ダーク' },
            ]}
          />
        </div>
        <PrivacySettings />
        {/** 不具合の報告で、どの版で起きたかを書いてもらうため */}
        <p className="app-version">版：{VERSION_LABEL}</p>
      </div>
    </aside>
  );
}
