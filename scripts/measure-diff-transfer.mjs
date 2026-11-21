/** 差分の計算・範囲への圧縮・応答の複製・表示行の復元を別々に測る。 */
import { serialize } from 'node:v8';
import { comparisonArguments, createComparison, measure } from './benchmark.mjs';

const { outputPath, ...options } = comparisonArguments();
const comparison = await createComparison('src/tools/text-diff/calculation.ts', options);
const packed = await comparison.loadWorkingTree('src/tools/text-diff/packed.ts');
const preview = await comparison.loadWorkingTree('src/tools/text-diff/preview.ts');
const reference = await comparison.loadWorkingTree('src/tools/text-diff/rowReference.testing.ts');
const cases = [];
const shapes = [
  ...[1000, 10_000, 100_000].flatMap((lines) => ['same', 'one'].map((shape) => ({ lines, shape }))),
  ...[1000, 10_000].flatMap((lines) => ['all', 'alternating', 'long', 'newlines'].map((shape) => ({ lines, shape }))),
];
for (const { lines, shape } of shapes) {
  const original = Array.from({ length: lines }, (_, i) => shape === 'newlines' ? '' : `行${i}${shape === 'long' ? '長い行'.repeat(100) : ''}`);
  const modified = original.map((line, i) => (shape === 'all' || (shape === 'alternating' && i % 2 === 0) || (['one', 'long', 'newlines'].includes(shape) && i === Math.floor(lines / 2))) ? `変更${i}` : line);
  const input = original.join(shape === 'newlines' ? '\r\n' : '\n');
  const after = modified.join(shape === 'newlines' ? '\r\n' : '\n');
  const request = { input, after, ignoreWhitespace: false, ignoreCase: false };
  const versions = {};
  let first;
  let firstPatch;
  let referenceRows;
  for (const [name, api] of Object.entries(comparison.versions)) {
    let result;
    const calculation = measure(() => { result = api.calculateDiff(request); });
    const options = { onlyChanges: true, context: 3, expanded: [], limit: 1000 };
    const old = Array.isArray(result.rows);
    const allRows = old ? result.rows : preview.splitPreview(result.rows, { ...options, onlyChanges: false, limit: result.rows.length }).shown;
    const beforeLines = allRows.flatMap((row) => row.left ? [row.left.text] : []);
    const afterLines = allRows.flatMap((row) => row.right ? [row.right.text] : []);
    if (JSON.stringify(beforeLines) !== JSON.stringify(original) || JSON.stringify(afterLines) !== JSON.stringify(modified)) throw new Error('差分から元の入力を復元できません');
    let patch = result.unified;
    const exportPreparation = typeof api.unifiedFromPacked === 'function' ? measure(() => { patch = api.unifiedFromPacked(result.rows); }) : null;
    if (first && !first.approximate && !result.approximate && firstPatch !== patch) throw new Error('全文パッチが変わっています');
    first ??= result;
    firstPatch ??= patch;
    referenceRows ??= allRows;
    const packing = old ? null : measure(() => packed.packRows(referenceRows, input, after));
    const clone = measure(() => structuredClone(result));
    const split = measure(() => old ? reference.visibleRows(result.rows, options).slice(0, options.limit) : preview.splitPreview(result.rows, options));
    const unified = measure(() => old ? reference.unifiedDisplayRows(reference.visibleRows(result.rows, options)).slice(0, options.limit) : preview.unifiedPreview(result.rows, options));
    versions[name] = { calculation, packing, clone, exportPreparation, splitRestore: split, unifiedRestore: unified, serializedBytes: serialize(result).byteLength,
      rowObjectsOrBlocks: old ? result.rows.length : result.rows.blocks.length, approximate: result.approximate };
  }
  cases.push({ lines, shape, inputUtf16: input.length, afterUtf16: after.length, versions });
  process.stderr.write(`完了：${shape} / ${lines}行\n`);
}
comparison.writeReport({
  scope: 'Nodeの計算全体・範囲への圧縮・structuredClone・先頭1000表示行の復元・V8 serializeサイズ。ヒープ使用量とブラウザの描画時間は対象外。',
  inputDescription: '同一・中央1行変更・全行変更・交互変更・長行・改行主体。探索打ち切りがある場合、最短パッチの一致ではなく元の入力を復元できることを確認する。',
  cases,
}, outputPath);
