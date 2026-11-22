import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** ビルド結果を変える入力。テスト専用のファイルは配信対象にならないため除外する。 */
const BUILD_INPUTS = ['src', 'public', 'index.html', 'vite.config.ts', 'csp.config.ts', 'scripts/third-party-licenses.mjs', 'tsconfig.json', 'package.json', 'package-lock.json'];
const TEST_ONLY = /\.(?:test|testing|fixtures)\.ts$|[\\/]fixtures\.ts$/;

/** 配信対象のファイルのうち、いちばん新しい更新時刻を調べる。 */
function newest(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return { time: TEST_ONLY.test(path) ? 0 : stat.mtimeMs, file: path };
  return readdirSync(path).reduce((found, name) => {
    const inner = newest(join(path, name));
    return inner.time > found.time ? inner : found;
  }, { time: 0, file: path });
}

/**
 * E2Eとブラウザ計測で、ソースより古いdistを配信する前に止める。
 * @remarks 更新時刻による確認。時刻を保存したコピーなどで内容の一致を証明するものではない。
 */
export function assertFreshBuild(root = process.cwd()) {
  const built = join(root, 'dist/index.html');
  if (!existsSync(built)) throw new Error('dist がありません。先に `npm run build` を実行してください。');
  const builtAt = statSync(built).mtimeMs;
  const changed = BUILD_INPUTS.map((path) => join(root, path)).filter(existsSync).map(newest).find(({ time }) => time > builtAt);
  if (changed) throw new Error(`${changed.file} が dist より新しいため、古いビルドを検査・計測することになります。先に \`npm run build\` を実行してください。`);
}
