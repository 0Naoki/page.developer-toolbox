import { useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { CommandPalette } from './components/CommandPalette';
import { usePreference } from './hooks/usePreference';
import { toolOf } from './registry';
import { isToolId, type ToolId } from './toolCatalog';
import { clearAllData, subscribeClearData } from './lib/storage';
import { arrayOf, isString } from './lib/settings';
import { Home } from './app/Home';
import { ToolPage } from './app/ToolPage';
import { Sidebar } from './app/Sidebar';
import { useTheme } from './app/useTheme';
import { focusMainHeading, useAppNavigation } from './app/useAppNavigation';

/** 最近使ったツールとして覚える件数 */
const MAX_RECENT = 5;
/** お気に入りとして読み込む件数の上限（保存された値の検証用。ツールの数より十分に大きくする） */
const MAX_FAVORITES = 100;
const isFavorites = arrayOf(isString, MAX_FAVORITES);
const NO_FAVORITES: string[] = [];

export function App() {
  const [clearFailure, setClearFailure] = useState<{ retry: () => void; sharedPending: boolean } | null>(null);
  useEffect(() => subscribeClearData((result) => {
    if (result.ok) location.reload();
    else setClearFailure({ retry: result.retry, sharedPending: result.sharedPending });
  }), []);
  const navigation = useAppNavigation();
  const { paletteOpen, setPaletteOpen } = navigation;
  /**
   * 保存値は文字列の配列として読み、ツールの一覧にない ID（削除したツール）は表示と操作から外す。
   * 保存値を ToolId の配列として検証すると、ツールを1つ削除しただけで一覧全体が検証に通らず、既定値（空）に戻ってしまうため
   */
  const [storedRecent, setRecent] = usePreference<string[]>('recent', [], arrayOf(isString, MAX_RECENT));
  const [storedFavorites, setFavorites] = usePreference<string[]>('favorites', NO_FAVORITES, isFavorites, true);
  const recent = storedRecent.filter(isToolId);
  const favorites = storedFavorites.filter(isToolId);
  const [theme, setTheme] = useTheme();

  /** ToolPage の useEffect の依存になるため、描画のたびに作り直さない */
  const markUsed = useCallback((id: ToolId) => setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, MAX_RECENT)), [setRecent]);

  const toggleFavorite = useCallback(
    (id: ToolId) => setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])),
    [setFavorites],
  );
  const favoriteTools = favorites.map(toolOf);

  if (clearFailure) {
    return (
      <main className="main">
        <h1>保存データの全消去</h1>
        <p role="alert">保存データの一部を消去できませんでした。ブラウザの保存設定を確認して再試行してください。</p>
        <button type="button" className="btn btn-primary" onClick={clearFailure.retry}>全消去を再試行</button>
        {clearFailure.sharedPending && (
          <>
            <p role="alert">共有の保存データの消去を確認できませんでした。再試行では共有領域を確認します。</p>
            <button type="button" className="btn btn-ghost" onClick={() => {
              if (window.confirm('他のタブで新しく保存した内容も含め、現在の保存データをすべて消去しますか？')) clearAllData();
            }}>現在の保存データをすべて消去</button>
          </>
        )}
      </main>
    );
  }

  return (
    <div className="layout">
      {/**
        キーボードで操作する人が、サイドバーの十数個の項目を飛ばして本文へ進めるようにする。
        HashRouter では href="#..." が画面の切り替えになるため、リンク先には移動せず見出しにフォーカスする
      */}
      <a
        href="#main-content"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          focusMainHeading();
        }}
      >
        本文へ移動
      </a>
      <Sidebar navigation={navigation} favoriteTools={favoriteTools} theme={theme} setTheme={setTheme} />

      <main className="main" id="main-content">
        <Routes>
          <Route path="/" element={<Home recent={recent.map(toolOf)} favorites={favoriteTools} />} />
          <Route path="/:id" element={<ToolPage onOpen={markUsed} favorites={favorites} onToggleFavorite={toggleFavorite} />} />
        </Routes>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
