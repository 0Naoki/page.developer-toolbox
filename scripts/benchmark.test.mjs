import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { comparisonArguments, createComparison } from './benchmark.mjs';
import { temporaryRepository } from './benchmark-test-fixtures.mjs';

const script = fileURLToPath(import.meta.url);

test('比較方式・基準コミット・出力先は順序に依存せず、不明な引数は拒否する', () => {
  assert.deepEqual(comparisonArguments(['out.json', '--comparison=tree', '--baseline=HEAD~1']), { outputPath: 'out.json', mode: 'tree', baseline: 'HEAD~1' });
  assert.deepEqual(comparisonArguments([]), { outputPath: undefined, mode: 'entry', baseline: 'HEAD' });
  for (const args of [['--comparison=other'], ['--baseline='], ['--oops'], ['a', 'b'], ['--baseline=A', '--baseline=B']]) {
    assert.throws(() => comparisonArguments(args));
  }
});

test('入口だけの局所比較と、削除・追加・ディレクトリimportを含むコミット全体の比較を区別する', async (t) => {
  const { root, write, git, save } = temporaryRepository(t);
  git('init', '-q');
  write('package-lock.json', '{}');
  write('entry.ts', "export { value } from './helper';");
  write('helper.ts', "import { offset } from './old'; export const value: number = offset + 1;");
  write('old/index.ts', 'export const offset = 1;');
  const commit = save();
  write('helper.ts', "import { offset } from './new'; export const value: number = offset + 1;");
  write('new.ts', 'export const offset = 9;');
  unlinkSync(join(root, 'old/index.ts'));
  const entry = await createComparison('entry.ts', { root, script });
  assert.equal(entry.versions.HEAD.value, 10);
  assert.equal(entry.versions.workingTree.value, 10);
  const tree = await createComparison('entry.ts', { root, script, mode: 'tree', baseline: commit });
  assert.equal(tree.versions.baseline.value, 2);
  assert.equal(tree.versions.workingTree.value, 10);
  const output = join(root, 'report.json');
  tree.writeReport({ cases: [] }, output);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(report.comparison, { mode: 'tree', baselineCommit: commit, baselineName: 'baseline' });
  assert.ok(report.provenance.baseline.files['old/index.ts']);
  assert.ok(!report.provenance.baseline.files['new.ts']);
  assert.ok(report.provenance.workingTree.files['new.ts']);
  write('new.ts', 'export const offset = 99;');
  assert.throws(() => tree.writeReport({}, output), /計測中に読み込んだファイルが変わりました/);
});

test('比較元にない依存と、異なる外部パッケージの条件を現行版で代用しない', async (t) => {
  const { root, write, git, save } = temporaryRepository(t);
  git('init', '-q');
  write('package-lock.json', '{}');
  write('entry.ts', "export { value } from './missing';");
  const commit = save();
  write('missing.ts', 'export const value = 10;');
  await assert.rejects(createComparison('entry.ts', { root, script, mode: 'tree' }), /現行のファイルへは代替しません/);
  write('package-lock.json', '{"changed":true}');
  await assert.rejects(createComparison('entry.ts', { root, script, mode: 'tree', baseline: commit }), /package-lock.jsonを一致/);
});
