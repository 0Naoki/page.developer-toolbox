/** 純粋関数の比較計測で、読み込み・予備実行・集計・ソースの追跡情報をそろえる。 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { committedSources } from './benchmark-sources.mjs';

const hash = (source) => createHash('sha256').update(source).digest('hex');

/** 比較方式と基準コミットを、出力ファイルの位置に関係なく指定できるようにする。 */
export function comparisonArguments(args = process.argv.slice(2)) {
  let mode = 'entry';
  let baseline = 'HEAD';
  let outputPath;
  const seen = new Set();
  for (const arg of args) {
    if (arg.startsWith('--comparison=') || arg.startsWith('--baseline=')) {
      const key = arg.slice(0, arg.indexOf('='));
      if (seen.has(key)) throw new Error(`${key} を重複して指定できません`);
      seen.add(key);
      if (key === '--comparison') mode = arg.slice(key.length + 1);
      else baseline = arg.slice(key.length + 1);
    } else if (arg.startsWith('--')) throw new Error(`未対応の引数です：${arg}`);
    else if (outputPath !== undefined) throw new Error('出力ファイルは1つだけ指定してください');
    else outputPath = arg;
  }
  if (!['entry', 'tree'].includes(mode) || baseline === '') throw new Error('--comparison は entry または tree、--baseline はコミットを指定してください');
  return { mode, baseline, outputPath };
}

/** 予備実行後に指定回数を測る。run 内で結果の正しさも検証する。 */
export function measure(run, repetitions = 3) {
  run();
  const runsMs = [];
  for (let i = 0; i < repetitions; i++) { const start = performance.now(); run(); runsMs.push(performance.now() - start); }
  return { runsMs, medianMs: [...runsMs].sort((a, b) => a - b)[Math.floor(repetitions / 2)] };
}

/**
 * 比較元をコミットSHAに固定する。entryは入口だけ、treeはリポジトリ内の依存も旧版から読む。
 * 実行したソースと生成コードのハッシュを記録し、計測中に HEAD・読み込んだファイルが変わったら記録しない。
 */
export async function createComparison(entry, { mode = 'entry', baseline = 'HEAD', root: requestedRoot = process.cwd(), script = process.argv[1] } = {}) {
  if (!['entry', 'tree'].includes(mode)) throw new Error('比較方式は entry または tree です');
  const startedAt = new Date().toISOString();
  const repositoryGit = (...args) => execFileSync('git', args, { cwd: requestedRoot, encoding: 'utf8', maxBuffer: 64 * 1024 ** 2 });
  const commit = repositoryGit('rev-parse', 'HEAD').trim();
  const root = repositoryGit('rev-parse', '--show-toplevel').trim();
  const baselineCommit = repositoryGit('rev-parse', '--verify', '--end-of-options', `${baseline}^{commit}`).trim();
  const entryPath = resolve(root, entry);
  const historical = committedSources(root, baselineCommit);
  const previous = historical.read(entryPath).toString('utf8');
  const snapshots = new Map();
  const snapshot = (path) => {
    if (!snapshots.has(path)) snapshots.set(path, readFileSync(path));
    return snapshots.get(path);
  };
  const lock = snapshot(resolve(root, 'package-lock.json'));
  if (mode === 'tree' && !lock.equals(historical.read(resolve(root, 'package-lock.json')))) {
    throw new Error('tree比較では比較元と作業ツリーのpackage-lock.jsonを一致させてください。異なる依存パッケージを現行版で代用しません。');
  }
  snapshot(fileURLToPath(import.meta.url));
  snapshot(fileURLToPath(new URL('./benchmark-sources.mjs', import.meta.url)));
  snapshot(resolve(script));
  const provenance = {};
  const load = async (name, replacement, inputPath = entryPath, fromCommit = false) => {
    const files = new Map();
    const bundle = await rolldown({ input: inputPath, plugins: [{
      name: 'benchmark-snapshot',
      resolveId: fromCommit ? (source, importer) => historical.resolve(source, importer) : undefined,
      load(id) {
        if (!isAbsolute(id)) return null;
        const path = resolve(id);
        const name = relative(root, path).replaceAll('\\', '/');
        if (fromCommit && !name.startsWith('../') && !name.startsWith('node_modules/') && !historical.has(path)) {
          throw new Error(`比較元に ${name} がありません。現行のファイルへは代替しません。`);
        }
        const source = fromCommit && historical.has(path) ? historical.read(path).toString('utf8')
          : path === entryPath && replacement !== undefined ? replacement : snapshot(path).toString('utf8');
        files.set(relative(root, path).replaceAll('\\', '/'), hash(source));
        return source;
      },
    }] });
    try {
      const { output } = await bundle.generate({ format: 'es' });
      const code = output[0].code;
      provenance[name] = { entry: relative(root, inputPath).replaceAll('\\', '/'), source: fromCommit ? baselineCommit : replacement === undefined ? 'workingTree' : 'entry', files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b))), bundleSha256: hash(code) };
      return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    } finally { await bundle.close(); }
  };
  const baselineName = mode === 'entry' && baseline === 'HEAD' ? 'HEAD' : 'baseline';
  const versions = { [baselineName]: await load(baselineName, previous, entryPath, mode === 'tree'), workingTree: await load('workingTree') };
  return {
    versions,
    /** 計測する補助の入口も同じスナップショットへ含め、後からソースが変わった場合は記録しない。 */
    loadWorkingTree: (path) => load(path, undefined, resolve(root, path)),
    /** 計測入力を作る補助スクリプトなども、変更検出とハッシュの対象に含める。 */
    trackFile: (path) => { snapshot(resolve(root, path)); },
    writeReport(data, outputPath) {
      if (repositoryGit('rev-parse', 'HEAD').trim() !== commit) throw new Error('計測中に HEAD が変わりました。測り直してください。');
      for (const [path, source] of snapshots) {
        if (!source.equals(readFileSync(path))) throw new Error('計測中に読み込んだファイルが変わりました。測り直してください。');
      }
      const report = {
        ...data, startedAt, measuredAt: new Date().toISOString(), commit, comparison: { mode, baselineCommit, baselineName }, modifiedFiles: repositoryGit('status', '--short').trim(),
        node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, repetitions: 3,
        provenance, snapshotFiles: Object.fromEntries([...snapshots].map(([path, source]) => [relative(root, path).replaceAll('\\', '/'), hash(source)])),
        dependencySource: mode === 'tree' ? '比較元のリポジトリ内の依存は固定コミットから読む。外部パッケージは同一package-lockの現行インストールを共有する。'
          : '両版とも作業ツリーの同じ依存スナップショットを使用。比較元は入口だけを固定コミットから読む。',
      };
      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (outputPath) writeFileSync(outputPath, json, 'utf8');
      else process.stdout.write(json);
    },
  };
}
