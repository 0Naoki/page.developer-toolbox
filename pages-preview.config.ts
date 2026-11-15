import { defineConfig } from 'vite';

/** 本番ビルドの手動確認とE2Eで使う配信設定。 */
const base = '/dev-toolbox/';
const host = 'localhost';
const port = 4173;

export const pagesPreviewUrl = `http://${host}:${port}${base}`;

export default defineConfig({
  base,
  preview: { host, port, strictPort: true },
});
