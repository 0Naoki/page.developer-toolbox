/** 純粋関数の比較計測で、読み込み・予備実行・集計・ソースの追跡情報をそろえる。 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const hash = (source) => createHash('sha256').update(source).digest('hex');

/** 予備実行後に指定回数を測る。run 内で結果の正しさも検証する。 */
export function measure(run, repetitions = 3) {
  run();
  const runsMs = [];
  for (let i = 0; i < repetitions; i++) { const start = performance.now(); run(); runsMs.push(performance.now() - start); }
  return { runsMs, medianMs: [...runsMs].sort((a, b) => a - b)[Math.floor(repetitions / 2)] };
}

/**
 * 開始時の HEAD を固定し、入口の旧版と作業ツリーを同じ依存のスナップショットで読み込む。
 * 実行したソースと生成コードのハッシュを記録し、計測中に HEAD・読み込んだファイルが変わったら記録しない。
 */
export async function createComparison(entry) {
  const startedAt = new Date().toISOString();
  const commit = git('rev-parse', 'HEAD').trim();
  const root = git('rev-parse', '--show-toplevel').trim();
  const entryPath = resolve(entry);
  const previous = git('show', `${commit}:${relative(root, entryPath).replaceAll('\\', '/')}`);
  const snapshots = new Map();
  const snapshot = (path) => {
    if (!snapshots.has(path)) snapshots.set(path, readFileSync(path));
    return snapshots.get(path);
  };
  snapshot(resolve('package-lock.json'));
  snapshot(fileURLToPath(import.meta.url));
  snapshot(resolve(process.argv[1]));
  const provenance = {};
  const load = async (name, replacement) => {
    const files = new Map();
    const bundle = await rolldown({ input: entryPath, plugins: [{
      name: 'benchmark-snapshot',
      load(id) {
        if (!isAbsolute(id)) return null;
        const path = resolve(id);
        const source = path === entryPath && replacement !== undefined ? replacement : snapshot(path).toString('utf8');
        files.set(relative(root, path).replaceAll('\\', '/'), hash(source));
        return source;
      },
    }] });
    try {
      const { output } = await bundle.generate({ format: 'es' });
      const code = output[0].code;
      provenance[name] = { entry, files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b))), bundleSha256: hash(code) };
      return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    } finally { await bundle.close(); }
  };
  const versions = { HEAD: await load('HEAD', previous), workingTree: await load('workingTree') };
  return {
    versions,
    writeReport(data, outputPath) {
      if (git('rev-parse', 'HEAD').trim() !== commit) throw new Error('計測中に HEAD が変わりました。測り直してください。');
      for (const [path, source] of snapshots) {
        if (!source.equals(readFileSync(path))) throw new Error('計測中に読み込んだファイルが変わりました。測り直してください。');
      }
      const report = {
        ...data, startedAt, measuredAt: new Date().toISOString(), commit, modifiedFiles: git('status', '--short').trim(),
        node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, repetitions: 3,
        provenance, snapshotFiles: Object.fromEntries([...snapshots].map(([path, source]) => [relative(root, path).replaceAll('\\', '/'), hash(source)])),
        dependencySource: '両版とも作業ツリーの同じスナップショットを使用。HEAD は入口だけを開始時のコミットから読む。',
      };
      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (outputPath) writeFileSync(outputPath, json, 'utf8');
      else process.stdout.write(json);
    },
  };
}
