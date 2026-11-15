/** リポジトリの Markdown（キーはルートからの「/docs/USAGE.md」の形）。生成物・依存関係のフォルダは対象外（glob には文字列しか書けないため、除外は各行に書く） */
export const markdown = import.meta.glob<string>(['/**/*.md', '/.github/**/*.md', '!**/node_modules/**', '!/dist/**', '!/test-results/**', '!/playwright-report/**'], { query: '?raw', import: 'default', eager: true });
/** テストのソース（残すべき検証を書いた先頭のコメントを確かめる） */
export const testSources = import.meta.glob<string>(['/e2e/*.spec.ts', '/src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true });
/** ツールの画面のソース（ファイルの分担を書いた先頭のコメントを確かめる） */
export const toolScreens = import.meta.glob<string>('/src/tools/*/index.tsx', { query: '?raw', import: 'default', eager: true });
/** ツールのフォルダのファイル（テストとテスト用のデータを除く。読み込みはしない） */
export const toolFiles = Object.keys(import.meta.glob(['/src/tools/*/*.{ts,tsx}', '!/src/tools/**/*.test.ts', '!/src/tools/**/*.fixtures.ts']));
/** リンク先の存在の確認に使う、リポジトリのファイルの一覧（読み込みはしない） */
const files = new Set(Object.keys(import.meta.glob(['/**/*', '/.github/**/*', '!**/node_modules/**', '!/dist/**', '!/test-results/**', '!/playwright-report/**'])));
/** glob の読み込み元は一覧に含まれないため、自分自身のパスだけを補う。 */
files.add('/src/documentSources.testing.ts');
export const exists = (path: string) => files.has(path) || [...files].some((f) => f.startsWith(`${path.replace(/\/$/, '')}/`));
/** コードのソース（コメントに書いたファイルのパスを確かめる。アプリ・テスト・E2E・スクリプト・ルートの設定・GitHub の設定） */
export const codeSources = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx}', '/e2e/**/*.{ts,mjs}', '/scripts/*.mjs', '/*.config.ts', '/.github/**/*.yml'],
  { query: '?raw', import: 'default', eager: true },
);
/** 計測スクリプトのソース（型チェック・単体テストの対象外のため、読み込むファイルのパスをここで確かめる） */
export const scriptSources = import.meta.glob<string>('/scripts/*.mjs', { query: '?raw', import: 'default', eager: true });
