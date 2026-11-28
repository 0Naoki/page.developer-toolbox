const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** ツール検索を開くキーの表記。サイドバーとトップページで同じ書き方にする */
export const SEARCH_SHORTCUT = isMac ? '⌘K' : 'Ctrl+K';
