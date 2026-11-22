/** 不正なHMAC鍵を拒否するまでのファイル読込回数と時間を、同じ合成Fileで変更前後に比較する。 */
import { comparisonArguments, createComparison } from './benchmark.mjs';

if (typeof globalThis.gc !== 'function') throw new Error('一時データを回収するため node --expose-gc を指定してください');
const { outputPath, ...options } = comparisonArguments();
const comparison = await createComparison('src/tools/hash/computeHashes.ts', options);
const context = { isCancelled: () => false, report: () => {} };
const cases = [];
for (const size of [1024 ** 2, 256 * 1024 ** 2]) {
  const file = new File([new Uint8Array(size)], 'synthetic.bin');
  const nativeRead = file.arrayBuffer.bind(file);
  let reads = 0;
  file.arrayBuffer = () => { reads++; return nativeRead(); };
  const versions = {};
  for (const [name, api] of Object.entries(comparison.versions)) {
    const runs = [];
    for (let repetition = -1; repetition < 3; repetition++) {
      await new Promise(setImmediate);
      globalThis.gc();
      const computer = api.createHashComputer();
      reads = 0;
      const start = performance.now();
      let message;
      try { await computer.run({ source: 'file', file, useHmac: true, key: '\ud800' }, context); }
      catch (error) { message = error.message; }
      const elapsedMs = performance.now() - start;
      computer.clear();
      if (!message?.includes('サロゲート')) throw new Error('不正な鍵を期待どおりに拒否しませんでした');
      if (repetition >= 0) runs.push({ elapsedMs, fileReads: reads, message });
    }
    versions[name] = { runs };
  }
  cases.push({ fileBytes: size, versions });
}
comparison.writeReport({
  scope: '合成Fileと対になっていないサロゲート1単位の鍵で、拒否までの読込回数と時間を比較。各版で予備実行1回・計測3回。File生成・GCは計測外。Nodeの関数呼出しであり、ブラウザの操作時間やピークメモリの計測ではない。',
  cases,
}, outputPath);
