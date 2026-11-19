import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** テスト専用の一時ディレクトリだけを作り、絶対パスを確認してから片付ける。 */
export function temporaryRepository(t) {
  const root = mkdtempSync(join(tmpdir(), 'toolbox-benchmark-'));
  t.after(() => {
    const target = realpathSync(root);
    assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.ok(basename(target).startsWith('toolbox-benchmark-'));
    rmSync(target, { recursive: true });
  });
  const write = (path, source) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  /** 実際の作業リポジトリには触れず、一時リポジトリに比較用のコミットを作る。 */
  const save = () => {
    git('add', '.');
    const tree = git('write-tree');
    const commit = git('-c', 'user.name=Benchmark test', '-c', 'user.email=benchmark@example.invalid', 'commit-tree', tree, '-m', '比較用のテストデータ');
    git('update-ref', 'HEAD', commit);
    return commit;
  };
  return { root, write, git, save };
}
