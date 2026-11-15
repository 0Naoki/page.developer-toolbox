/** ほかの import より先に評価させるため、最初に書く */
import './trustedTypes';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { LaunchNotice } from './app/LaunchNotice';
import { prepareStorage } from './lib/storage';
import { toolCatalog } from './toolCatalog';
import './styles.css';

/**
 * 描画の前に、今の形式で使わないキー（削除したツールの入力と表示設定、以前の版が残したキー）を消す（画面から消せないまま残り続けないよう）
 */
prepareStorage(toolCatalog.map((tool) => tool.id));

/**
 * ほかのページの中で開かれたら、アプリを表示しない（クリックジャッキング対策）。
 * GitHub Pages では X-Frame-Options などのヘッダを送れず、<meta> の CSP では frame-ancestors が効かないため、ここで防ぐ
 */
const framed = window.self !== window.top;
/**
 * 開いた側との関係を解除する。解除前に検出し、入力欄を出さずnoopenerの別タブへ案内する。
 * この補助対策は、応答ヘッダのCOOPによる閲覧コンテキストの分離と同じ保証ではない。
 */
const opened = window.opener !== null;
if (opened) window.opener = null;
const restrictedLaunch = framed ? 'frame' : opened ? 'opener' : null;

/** GitHub Pages ではサーバー側のルーティングが使えないため HashRouter（#/json 形式）を使用 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {restrictedLaunch ? (
      <LaunchNotice reason={restrictedLaunch} />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </StrictMode>,
);
