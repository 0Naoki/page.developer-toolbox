import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertFreshBuild } from './build-freshness.mjs';
import { temporaryRepository } from './benchmark-test-fixtures.mjs';

test('distがなければ、ブラウザを起動する前に拒否する', (t) => {
  const { root } = temporaryRepository(t);
  assert.throws(() => assertFreshBuild(root), /npm run build/);
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('./measure-large-inputs.mjs', import.meta.url)), '--count-budget'],
    { cwd: root, stdio: 'pipe' }), (error) => error.status === 1 && error.stderr.toString().includes('dist がありません'));
});

test('ソース・公開資産・ビルド設定・依存定義の更新を両利用先で共通に検出する', (t) => {
  const { root, write } = temporaryRepository(t);
  write('dist/index.html', 'built');
  utimesSync(join(root, 'dist/index.html'), 3000, 3000);
  for (const path of ['src/app.ts', 'public/icon.svg', 'index.html', 'vite.config.ts', 'csp.config.ts', 'scripts/third-party-licenses.mjs', 'tsconfig.json', 'package.json', 'package-lock.json']) {
    write(path, 'source');
    utimesSync(join(root, path), 2000, 2000);
    assert.doesNotThrow(() => assertFreshBuild(root));
    utimesSync(join(root, path), 4000, 4000);
    assert.throws(() => assertFreshBuild(root), /dist より新しい/);
    utimesSync(join(root, path), 2000, 2000);
  }
  /** 一致する更新時刻を、不要な再ビルドとして拒否しない。 */
  utimesSync(join(root, 'src/app.ts'), 3000, 3000);
  assert.doesNotThrow(() => assertFreshBuild(root));
});

test('単体テスト・静的検査・データ・文書・スクリプトだけの更新は除外する', (t) => {
  const { root, write } = temporaryRepository(t);
  write('dist/index.html', 'built');
  utimesSync(join(root, 'dist/index.html'), 3000, 3000);
  for (const path of ['src/app.test.ts', 'src/rules.testing.ts', 'src/time.fixtures.ts', 'src/example/fixtures.ts', 'docs/TESTING.md', 'scripts/benchmark.mjs']) {
    write(path, 'test');
    utimesSync(join(root, path), 4000, 4000);
  }
  assert.doesNotThrow(() => assertFreshBuild(root));
});
