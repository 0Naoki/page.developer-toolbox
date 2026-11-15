import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ビルドの結果を変える入力。これらのどれかが dist より新しければ、ビルドし直していない。
 * tsconfig.json は変換の設定（JSX など）として、package.json はビルドのスクリプトと依存の指定として、ビルドに使われる
 */
const BUILD_INPUTS = ['src', 'public', 'index.html', 'vite.config.ts', 'csp.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];

/** テストからだけ使うファイル（単体テスト・静的検査の規則・テスト用のデータ）。ビルドの結果を変えない */
const TEST_ONLY = /\.(?:test|testing|fixtures)\.ts$|[\\/]fixtures\.ts$/;

/** ファイルまたはディレクトリの中で、いちばん新しい更新時刻と、そのファイル */
/** @param {string} path @returns {{ time: number; file: string }} */
function newest(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return { time: TEST_ONLY.test(path) ? 0 : stat.mtimeMs, file: path };
  return readdirSync(path).reduce((found, name) => {
    const inner = newest(join(path, name));
    return inner.time > found.time ? inner : found;
  }, { time: 0, file: path });
}

/**
 * E2E は配信するビルド（dist）に対して実行するため、ソースを変えた後にビルドし直していなければ止める。
 *
 * @remarks
 * `npm run e2e:run` はビルドしない。古い dist のまま実行すると、直したはずの不具合で失敗したり、
 * 新しく壊したところを見逃したりする（失敗の原因がソースかビルドの古さかを見分けにくい）。
 */
export default function globalSetup() {
  const built = 'dist/index.html';
  if (!existsSync(built)) throw new Error('dist がありません。先に `npm run build` を実行してください（`npm run e2e` はビルドから実行します）。');
  const builtAt = statSync(built).mtimeMs;
  const changed = BUILD_INPUTS.filter((path) => existsSync(path)).map(newest).find(({ time }) => time > builtAt);
  if (changed) {
    throw new Error(`${changed.file} が dist より新しいため、古いビルドを検査することになります。先に \`npm run build\` を実行してください（\`npm run e2e\` はビルドから実行します）。`);
  }
}
