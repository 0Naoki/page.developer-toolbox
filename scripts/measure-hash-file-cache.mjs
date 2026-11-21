/** ファイルHMACの鍵変更で、読込回数と計算後に残るArrayBufferを変更前後で比較する。 */
import { createHash } from 'node:crypto';
import { comparisonArguments, createComparison } from './benchmark.mjs';

if (typeof globalThis.gc !== 'function') throw new Error('メモリの観測には node --expose-gc を指定してください');
const entry = 'src/tools/hash/computeHashes.ts';
const { outputPath, ...options } = comparisonArguments();
const comparison = await createComparison(entry, options);
const context = { isCancelled: () => false, report: () => {} };
const collect = async () => { await new Promise(setImmediate); globalThis.gc(); return process.memoryUsage().arrayBuffers; };
const cases = [];
for (const size of [1024 ** 2, 8 * 1024 ** 2, 256 * 1024 ** 2]) {
  const file = new File([new Uint8Array(size).fill(97)], 'synthetic.bin');
  const native = file.arrayBuffer.bind(file);
  let reads = 0;
  file.arrayBuffer = () => { reads++; return native(); };
  const versions = {};
  let expected;
  for (const [name, api] of Object.entries(comparison.versions)) {
    const runs = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      const computer = api.createHashComputer?.() ?? { run: api.computeHashes, clear: () => {} };
      reads = 0;
      const memoryBefore = await collect();
      const start = performance.now();
      const results = [];
      for (const key of ['synthetic-key-a', 'synthetic-key-b']) results.push(await computer.run({ source: 'file', file, useHmac: true, key }, context));
      const elapsedMs = performance.now() - start;
      const resultSha256 = createHash('sha256').update(JSON.stringify(results)).digest('hex');
      expected ??= resultSha256;
      if (resultSha256 !== expected) throw new Error('鍵ごとの計算結果が変わっています');
      const retainedArrayBuffers = (await collect()) - memoryBefore;
      computer.clear();
      const afterClearArrayBuffers = (await collect()) - memoryBefore;
      runs.push({ elapsedMs, fileReads: reads, retainedArrayBuffers, afterClearArrayBuffers, resultSha256 });
      process.stderr.write(`完了：${size} bytes / ${name} / ${repetition + 1}\n`);
    }
    versions[name] = { runs };
  }
  cases.push({ fileBytes: size, keysPerRun: 2, versions });
}
comparison.writeReport({
  scope: '同一FileのHMACを2つの鍵で順に計算。各3回。arrayBuffersはGC後の観測であり、最大メモリ・RSS・ブラウザの性能ではない。入力と鍵は計測用の架空データ。',
  cases,
}, outputPath);
