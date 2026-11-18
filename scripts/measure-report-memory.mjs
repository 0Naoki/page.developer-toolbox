/** 全件診断の集約・文字列化・上限拒否で、チェックポイントのheapUsedを比較する。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
import { rolldown } from 'rolldown';

if (!global.gc) throw new Error('node --expose-gc で実行してください');
const [beforePath, outputPath] = process.argv.slice(2);
if (!beforePath || !outputPath) throw new Error('変更前ソースの保存先と、結果JSONの保存先を指定してください');
const entry = 'src/tools/text-count/reports.ts';
const sourceNames = [entry, 'src/tools/text-count/issues.ts'];
const before = beforePath.endsWith('.json') ? JSON.parse(readFileSync(beforePath, 'utf8')).sources.before
  : Object.fromEntries(sourceNames.map((path) => [path, readFileSync(resolve(beforePath, `${path.split('/').at(-1).replace('.ts', '')}.before.ts`), 'utf8')]));
const snapshots = new Map();
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const snapshot = (path) => {
  if (!snapshots.has(path)) snapshots.set(path, readFileSync(path, 'utf8'));
  return snapshots.get(path);
};
snapshot(resolve(process.argv[1]));
snapshot(resolve('package-lock.json'));
const provenance = {};
/** 変更前後で同じ箇所に観測を入れる。観測用の生成コードだけを加工し、アプリのソースは変更しない。 */
function instrument(source, file) {
  if (file === entry && source.includes('collectIssues(input, kind)')) return source
    .replace('collectIssues(input, kind)', 'globalThis.__reportHeap(collectIssues(input, kind))')
    .replace('parts.push(text);', 'parts.push(text); if (parts.length % 1024 === 0) globalThis.__reportHeap();')
    .replace("return parts.join('');", "const complete = parts.join(''); globalThis.__reportHeap(); return complete;");
  if (file === entry) return source.replace('for (const [char, value] of counts)', 'globalThis.__reportHeap(); for (const [char, value] of counts)');
  if (file.endsWith('/reportText.ts')) return source
    .replace("this.chunks.push(this.pending.join(''));", "this.chunks.push(this.pending.join('')); globalThis.__reportHeap();")
    .replace("return this.chunks.join('');", "const complete = this.chunks.join(''); globalThis.__reportHeap(); return complete;")
    .replace('if (length > this.limit) throw', 'if (length > this.limit) globalThis.__reportHeap(); if (length > this.limit) throw');
  return source;
}
async function load(name) {
  const files = {};
  const bundle = await rolldown({ input: entry, plugins: [{ name: 'report-memory-snapshot', load(id) {
    if (!isAbsolute(id)) return null;
    const path = relative(process.cwd(), id).replaceAll('\\', '/');
    const source = name === 'before' && before[path] !== undefined ? before[path] : snapshot(id);
    files[path] = sha256(source);
    return instrument(source, path);
  } }] });
  try {
    const { output } = await bundle.generate({ format: 'esm' });
    provenance[name] = { files, instrumentedBundleSha256: sha256(output[0].code) };
    return await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
  } finally { await bundle.close(); }
}
const versions = { before: await load('before'), after: await load('after') };
const cases = [];
for (const [codePoints, limit] of [[10_000, 32_000_000], [100_000, 32_000_000], [100_000, 200]]) {
  const input = Array.from({ length: codePoints }, (_, i) => String.fromCodePoint(0x10000 + i)).join('');
  const results = {};
  for (const [name, api] of Object.entries(versions)) {
    globalThis.__reportHeap = (value) => value;
    try { api.createDiagnosticReport(input, 'unsupported', limit); } catch { /** 上限拒否のケースも予備実行する。 */ }
    const runs = [];
    for (let n = 0; n < 3; n++) {
      global.gc();
      const startHeap = process.memoryUsage().heapUsed;
      let peakHeap = startHeap;
      let samples = 0;
      globalThis.__reportHeap = (value) => { samples++; peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); return value; };
      let output;
      let error = null;
      try { output = api.createDiagnosticReport(input, 'unsupported', limit); } catch (e) { error = e.message; }
      runs.push({ startHeap, observedPeakHeap: peakHeap, observedIncrease: peakHeap - startHeap, samples,
        outputLength: output?.length ?? null, outputSha256: output === undefined ? null : sha256(output), error });
      output = undefined;
    }
    results[name] = runs;
  }
  if (results.before[0].outputSha256 !== results.after[0].outputSha256 || results.before[0].error !== results.after[0].error) throw new Error('出力または上限拒否の結果が変わっています');
  cases.push({ codePoints, limit, results });
}
for (const [path, source] of snapshots) if (source !== readFileSync(path, 'utf8')) throw new Error('計測中にソースが変わりました');
writeFileSync(outputPath, JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), repetitions: 3,
  scope: '予備実行後、各試行の前にGC。集約直後・文字列化中・結合直後・上限拒否のチェックポイントのheapUsedを観測。GCで回収可能なごみを含み、観測間のピーク・RSS・ブラウザのメモリではない。観測用コードを挿入したため時間比較には使わない。入力作成と出力ハッシュの計算は除外。',
  instrumentation: instrument.toString(), sources: { before, after: Object.fromEntries(sourceNames.map((path) => [path, snapshot(resolve(path))])) }, provenance,
  snapshotFiles: Object.fromEntries([...snapshots].map(([path, source]) => [relative(process.cwd(), path).replaceAll('\\', '/'), sha256(source)])), cases,
}, null, 2) + '\n');
