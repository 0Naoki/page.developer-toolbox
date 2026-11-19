import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

/** リポジトリの作業ツリーやブランチを変えず、固定コミットから計測用の依存を読む。 */
export function committedSources(root, commit) {
  const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 ** 2 });
  const files = new Set(git('ls-tree', '-rz', '--name-only', commit).toString('utf8').split('\0').filter(Boolean));
  const sources = new Map();
  const pathOf = (path) => relative(root, path).replaceAll('\\', '/');
  const read = (path) => {
    const name = pathOf(path);
    if (!files.has(name)) throw new Error(`比較元 ${commit} に ${name} がありません`);
    if (!sources.has(name)) sources.set(name, git('show', `${commit}:${name}`));
    return sources.get(name);
  };
  return {
    read,
    has: (path) => files.has(pathOf(path)),
    /** 現行のファイルが消えた・移動した場合も、比較元にある相対importだけを解決する。 */
    resolve(source, importer) {
      if (isAbsolute(source)) return files.has(pathOf(source)) ? source : null;
      if (!source.startsWith('.') || !importer || !files.has(pathOf(importer))) return null;
      const path = resolve(importer, '..', source);
      const candidates = [path, ...['.ts', '.tsx', '.mts', '.mjs', '.js', '.json'].map((ext) => path + ext),
        ...['.ts', '.tsx', '.mjs', '.js', '.json'].map((ext) => resolve(path, `index${ext}`))];
      const found = candidates.find((candidate) => files.has(pathOf(candidate)));
      if (!found) throw new Error(`比較元 ${commit} の ${pathOf(importer)} から ${source} を解決できません。現行のファイルへは代替しません。`);
      return found;
    },
  };
}
