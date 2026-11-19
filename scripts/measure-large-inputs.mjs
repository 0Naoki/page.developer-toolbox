/**
 * 本番ビルドをローカルで開き、合成データの入力から結果表示までと描画間隔を測る。
 * 実行前に npm run build。引数に測定結果の保存先を指定できる。
 * --subnet を指定すると、サブネットの集約・重複チェックだけを10万件で測る。
 * --password を指定すると、記号集合の長さと異なる文字数を変え、入力から新しい生成結果の描画までを測る。
 * --count-diagnostics を指定すると、文字診断の入力を反復・多種類のUnicodeに分けて測る。
 * --count-render-profile は入力欄・診断一覧の非表示比較とWorker・DOM更新の区間を測る。
 * --count-budget は文字診断の通常表示を同じケースで測り、文書に定めた初期目標も判定する。
 *
 * 各ケースを RUNS_PER_CASE 回測り、毎回の値と、中央値・最小・最大を記録する。
 * 入力の形（行数・1行の長さ・全体の長さ）も記録し、条件の違う結果と比べないようにする。
 * 各ケースが結果と上限エラーのどちらの画面で終わるかを決めておき、観測した終了状態（outcome）を記録する。
 * 期待と違う状態で終わったケースは失敗として記録する。
 *
 * 配信した dist の内容のハッシュ（build.distSha256）も記録する。対象コミットでビルドし直してから
 * --dist-hash を付けて実行すると、ハッシュだけを表示する。値を比べると、測ったビルドがそのコミットのものかを確かめられる。
 * 毎回の試行の後で dist を照合し直し、計測中に変わったら計測を止めて記録全体を無効（invalid・build.changedDuring）にする。
 */
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { passwordInputs } from './password-inputs.mjs';
import { assertFreshBuild } from './build-freshness.mjs';

/** 各ケースを測る回数（ばらつきを見るため、毎回新しいページで測る） */
const RUNS_PER_CASE = 3;
const MEASURE_VIEWPORT = { width: 1280, height: 720 };
const ROWS = [1000, 10000, 100000];
const args = process.argv.slice(2);
const subnetOnly = args.includes('--subnet');
const diffOnly = args.includes('--diff');
const passwordOnly = args.includes('--password');
const countRenderProfile = args.includes('--count-render-profile');
const countBudget = args.includes('--count-budget');
if (countRenderProfile && countBudget) throw new Error('--count-render-profile と --count-budget は同時に指定できません');
const countDiagnosticsOnly = args.includes('--count-diagnostics') || countRenderProfile || countBudget;
if ([subnetOnly, diffOnly, passwordOnly, countDiagnosticsOnly].filter(Boolean).length > 1) throw new Error('--subnet・--diff・--password・--count-diagnostics は同時に指定できません');
const distHashOnly = args.includes('--dist-hash');
const [outputPath] = args.filter((arg) => !['--subnet', '--diff', '--password', '--count-diagnostics', '--count-render-profile', '--count-budget', '--dist-hash'].includes(arg));

/** git の出力。git がない環境でも計測は続ける */
const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

/**
 * 配信する dist の全ファイルを相対パスの順に並べ、パス・長さ・内容をまとめてハッシュにする。
 * 成果物のファイル名は内容のハッシュを含むため、同じソースからのビルドなら同じ値になる
 */
async function distBuild() {
  const files = (await readdir('dist', { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/').replace(/^dist\//, ''))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const content = await readFile(`dist/${file}`);
    hash.update(`${file}\0${content.length}\0`).update(content);
  }
  return {
    distSha256: hash.digest('hex'),
    files: files.length,
    /** ビルドした時刻の目安（測定前のビルドし忘れに気づくため） */
    indexModifiedAt: (await stat('dist/index.html')).mtime.toISOString(),
  };
}

if (distHashOnly) {
  console.log((await distBuild()).distSha256);
  process.exit(0);
}

/** 入力データの準備やサーバー・ブラウザの起動より先に、ビルドし忘れを知らせる。 */
assertFreshBuild();

/**
 * 計測するツール。inputs は入力欄の名前（aria-label）と値の組で、最後の入力を設定してからの時間を測る。
 * done はページの中で評価する、終了したかの判定。計算中（data-calculation-state が pending）は false にする。
 * 結果の画面でだけ終わるケースは真偽値を返し、上限エラーの画面でも終わるケースは 'result' か 'error' を返す。
 * expected は行数ごとに期待する終了状態（省略時は 'result'）。観測した状態（outcome）と違えば失敗として記録する
 */
const CASES = [
  {
    tool: 'json',
    line: '{"id":9007199254740993,"name":"山田","amount":100.00}',
    inputs: (rows, line) => [[null, `[${Array(rows).fill(line).join(',')}]`]],
    done: () => !document.querySelector('[data-calculation-state="pending"]') && document.querySelector('textarea[aria-label="出力"]')?.value.includes('9007199254740993'),
  },
  {
    tool: 'csv',
    line: '9007199254740993,山田,100.00',
    inputs: (rows, line) => [[null, `id,name,amount\n${Array(rows).fill(line).join('\n')}`]],
    done: () => !document.querySelector('[data-calculation-state="pending"]') && document.querySelector('textarea[aria-label^="出力"]')?.value.includes('9007199254740993'),
  },
  {
    tool: 'count',
    line: '山田ABC123😀',
    inputs: (rows, line) => [[null, Array(rows).fill(line).join('\n')]],
    done: (rows) => !document.querySelector('[data-calculation-state="pending"]') && [...document.querySelectorAll('.stat')].some((stat) =>
      stat.querySelector('.stat-label')?.textContent === '行数' && stat.querySelector('.stat-value')?.textContent === rows.toLocaleString('ja-JP')),
  },
  {
    tool: 'diff',
    line: '山田ABC123😀 の行',
    /** 10行に1行だけ変える */
    inputs: (rows, line) => [
      ['変更前', Array.from({ length: rows }, (_, i) => `${i} ${line}`).join('\n')],
      ['変更後', Array.from({ length: rows }, (_, i) => (i % 10 === 0 ? `${i} 変更した行` : `${i} ${line}`)).join('\n')],
    ],
    done: (rows) => !document.querySelector('[data-calculation-state="pending"]') && document.querySelector('.badge-add')?.textContent === `+${rows / 10} 行`,
  },
  {
    tool: 'base64',
    line: 'あいうえおabc',
    inputs: (rows, line) => [['入力', Array(rows).fill(line).join('\n')]],
    done: () => !document.querySelector('[data-calculation-state="pending"]') && (document.querySelector('textarea[aria-label="出力"]')?.value.length ?? 0) > 0,
  },
  /** 以下は入力欄の描画が画面を止めないかを見るケース。結果または上限エラーの表示まで測る */
  {
    tool: 'hash',
    line: 'あいうえおabc',
    inputs: (rows, line) => [['テキスト（UTF-8）', Array(rows).fill(line).join('\n')]],
    done: () => [...document.querySelectorAll('.hash-value')].some((cell) => /^[0-9a-f]{64}$/.test(cell.textContent ?? '')),
  },
  {
    tool: 'jwt',
    line: 'あいうえおabc',
    /** ペイロードに長い文字列を持つトークン（署名は検証しない） */
    inputs: (rows, line) => [['トークン', `${base64url('{"alg":"HS256"}')}.${base64url(JSON.stringify({ data: Array(rows).fill(line).join(' ') }))}.signature`]],
    done: () => [...document.querySelectorAll('pre')].some((pre) => pre.textContent?.includes('"data"')),
  },
  {
    tool: 'cert',
    line: '証明書（PEM）1枚',
    /**
     * 行数の1/100枚の証明書を並べる。1,000行（10枚）は解析結果になる。
     * 10,000行（100枚）は PEM のブロック数の上限（64）を、100,000行（1,000枚）は入力の長さの上限を超え、エラーの表示になる
     */
    inputs: (rows) => [['証明書または CSR（PEM）', Array(rows / 100).fill(LEAF).join('\n')]],
    expected: (rows) => (rows <= 1000 ? 'result' : 'error'),
    done: () => document.querySelector('.cert-card') ? 'result' : document.querySelector('.error-text, .error-box') ? 'error' : false,
  },
  {
    tool: 'regex',
    line: 'あいうえおabc 123',
    /** 1,000行（約1.3万単位）はマッチ件数になる。1万行（約13万単位）以上はテスト文字列の上限（10万単位）を超え、エラーの表示になる */
    inputs: (rows, line) => [['正規表現', '\\d+'], ['テスト文字列', Array(rows).fill(line).join('\n')]],
    expected: (rows) => (rows <= 1000 ? 'result' : 'error'),
    done: () => {
      const text = document.body.textContent ?? '';
      return text.includes('計算できません') ? 'error' : /件(以上)?のマッチ/.test(text) ? 'result' : false;
    },
  },
];

/** 設定欄への入力から、プレビューと新しい生成結果が描画されるまで。全文の編集は開かない。 */
const PASSWORD_CASES = passwordOnly ? passwordInputs().map(({ symbols, ...shape }) => ({
  tool: 'password', line: symbols.slice(0, 2), shape: { ...shape, symbolSetUtf16: symbols.length }, paste: true,
  prepare: async (page) => page.addInitScript(() => {
    localStorage.setItem('dev-toolbox:pref:password:options', JSON.stringify({ length: 16, upper: false, lower: false, digits: false,
      symbols: true, symbolSet: '!', exclude: '', excludeAmbiguous: false, requireEach: false }));
  }),
  inputs: () => [['使用する記号', symbols]],
  done: () => {
    const input = document.querySelector('textarea[aria-label="使用する記号"]');
    const values = [...document.querySelectorAll('.pw-list .value-text')];
    return (input?.value.startsWith('x') || input?.value.startsWith(String.fromCodePoint(0x10000))) && input.value.length <= 2000 &&
      values.length === 5 && values.every((node) => !node.textContent.includes('!') && Array.from(node.textContent).length === 16);
  },
})) : [];

/** 同じ入力長で、重複除去後の文字数が1種類・全種類の2通りを使う。 */
const COUNT_DIAGNOSTIC_CASES = ['repeated', 'distinct'].flatMap((alphabet) => (countRenderProfile ? ['baseline', 'input-hidden', 'badges-hidden', 'results-hidden'] : [null]).map((renderMode) => ({
  tool: 'count', alphabet, renderMode: renderMode ?? (countDiagnosticsOnly ? 'baseline' : null), line: alphabet === 'repeated' ? '😀' : String.fromCodePoint(0x10000), paste: true, pasteLimit: 50_000,
  inputs: (rows) => [['テキスト', alphabet === 'repeated' ? '😀'.repeat(rows) : Array.from({ length: rows }, (_, i) => String.fromCodePoint(0x10000 + i)).join('')]],
  done: (rows) => !document.querySelector('[data-calculation-state="pending"]') && [...document.querySelectorAll('.stat')].some((stat) =>
    stat.querySelector('.stat-label')?.textContent === 'コードポイント' && stat.querySelector('.stat-value')?.textContent === rows.toLocaleString('ja-JP')),
})));

/** 測定記録と同じ、重複も隣接もしないIPv4アドレスを作る。 */
function subnetInput(rows, suffix = '') {
  return Array.from({ length: rows }, (_, i) =>
    `10.${i >> 15}.${(i >> 7) & 255}.${(i & 127) * 2}${suffix}`,
  ).join('\n');
}

const SUBNET_CASES = [
  {
    tool: 'subnet',
    mode: 'aggregate',
    tab: '集約・範囲変換',
    line: '10.0.0.0',
    inputs: (rows) => [['CIDR・アドレスの範囲・アドレスの一覧（1行に1つ）', subnetInput(rows)]],
    done: (rows) => [...document.querySelectorAll('.status-row .badge')].some((badge) =>
      badge.textContent === `${rows.toLocaleString('ja-JP')} 個の CIDR`),
  },
  {
    tool: 'subnet',
    mode: 'overlap',
    tab: '重複チェック',
    line: '10.0.0.0/32',
    inputs: (rows) => [['CIDR の一覧（1行に1つ。後ろに名前を書けます）', subnetInput(rows, '/32')]],
    done: (rows) => document.querySelector('.notice.good')?.textContent === `${rows} 件の範囲に、重なりはありません。`,
  },
];

/** 証明書のケースで使う、テスト用の証明書（src/tools/cert/certificates.fixtures.ts の LEAF） */
const LEAF = (await readFile('src/tools/cert/certificates.fixtures.ts', 'utf8')).match(/export const LEAF = `([^`]+)`/)[1];
const base64url = (text) => Buffer.from(text).toString('base64url');

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
const summarize = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values) });

/** 1回分の計測。新しいページで入力を設定し、結果の表示までの時間と最大の描画間隔を返す */
async function measureOnce(browser, { tool, tab, inputs, done, prepare, paste, pasteLimit = 2000, renderMode }, rows, line) {
  const page = await browser.newPage({ locale: 'ja-JP', viewport: MEASURE_VIEWPORT, deviceScaleFactor: 1 });
  try {
    if (prepare) await prepare(page);
    if (renderMode) await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', () => { if (this.isCount && window.measurement) window.measurement.workerReceivedAt = performance.now(); });
        }
        postMessage(request, ...rest) {
          this.isCount = request?.tool === 'count';
          if (this.isCount && window.measurement) window.measurement.workerPostedAt = performance.now();
          return super.postMessage(request, ...rest);
        }
      };
    });
    await page.goto(`http://127.0.0.1:4174/#/${tool}`);
    if (tab) await page.getByRole('button', { name: tab, exact: true }).click();
    if (renderMode) await page.evaluate((mode) => {
      const css = mode === 'input-hidden' ? 'textarea[aria-label="テキスト"]' : mode === 'badges-hidden' ? '.tag-list' : mode === 'results-hidden' ? '.stats, .notice' : null;
      if (css) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`${css} { display: none !important; }`);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
    }, renderMode);
    const values = inputs(rows, line);
    const fill = async ([label, value]) => {
      const input = renderMode === 'input-hidden' ? page.locator('textarea[aria-label="テキスト"]')
        : label === null ? page.locator('textarea:not([readonly])').first() : page.getByRole('textbox', { name: label, exact: true }).first();
      await input.waitFor({ state: renderMode === 'input-hidden' ? 'attached' : 'visible' });
      await input.evaluate((element, { text, paste, pasteLimit }) => {
        const start = performance.now();
        if (paste && text.length > pasteLimit) {
          const data = new DataTransfer();
          data.setData('text/plain', text);
          element.setSelectionRange(0, element.value.length);
          const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', { value: data });
          element.dispatchEvent(event);
          if (window.measurement) window.measurement.dispatchMs = performance.now() - start;
          return;
        }
        /** DOM の標準の value セッターと input イベントで渡す（キー入力や fill の待ちを含めないため） */
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, text);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        if (window.measurement) window.measurement.dispatchMs = performance.now() - start;
      }, { text: value, paste, pasteLimit }, { timeout: 60000 });
    };
    for (const value of values.slice(0, -1)) await fill(value);
    await page.evaluate((expected) => {
      const sample = { start: performance.now(), last: performance.now(), maxGap: 0, frames: 0, running: true };
      window.measurement = sample;
      const frame = (now) => {
        sample.maxGap = Math.max(sample.maxGap, now - sample.last);
        sample.last = now;
        sample.frames++;
        if (sample.running) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const observer = new MutationObserver(() => {
        if (!sample.resultDomAt && [...document.querySelectorAll('.stat')].some((stat) => stat.querySelector('.stat-label')?.textContent === 'コードポイント' && stat.querySelector('.stat-value')?.textContent === expected.toLocaleString('ja-JP'))) sample.resultDomAt = performance.now();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      sample.stopObserving = () => observer.disconnect();
    }, rows);
    await fill(values.at(-1));
    const finished = await (await page.waitForFunction(done, rows, { timeout: 60000 })).jsonValue();
    const sample = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sample = window.measurement;
      sample.running = false;
      sample.stopObserving();
      const elapsed = Math.round(performance.now() - sample.start);
      return { inputToResultMs: elapsed, maxFrameGapMs: Math.round(sample.maxGap), frames: sample.frames,
        dispatchMs: sample.dispatchMs, workerPostedMs: sample.workerPostedAt ? sample.workerPostedAt - sample.start : null,
        workerReceivedMs: sample.workerReceivedAt ? sample.workerReceivedAt - sample.start : null,
        resultDomMs: sample.resultDomAt ? sample.resultDomAt - sample.start : null,
        domToEndMs: sample.resultDomAt ? performance.now() - sample.resultDomAt : null };
    });
    sample.outcome = typeof finished === 'string' ? finished : 'result';
    return { sample, inputUnits: values.reduce((n, [, value]) => n + value.length, 0) };
  } finally {
    await page.close();
  }
}

/** 計測の途中でビルドし直されても気づけるよう、配信を始める前に dist を読む */
const build = await distBuild();
const server = await preview({ preview: { host: '127.0.0.1', port: 4174, strictPort: true } });
let browser;
const results = [];
try {
  browser = await chromium.launch();
  /** 比較できるよう、測定日時・対象コミット・未コミットの変更の有無・配信した dist・環境・実行回数を記録する */
  const status = git('status', '--porcelain');
  const report = {
    measuredAt: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD'),
    uncommittedChanges: status === null ? null : status !== '',
    build,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
    runtime: process.version,
    browser: browser.version(),
    viewport: MEASURE_VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'ja-JP',
    runsPerCase: RUNS_PER_CASE,
    results,
    ...(countBudget ? { budget: { inputToResultMedianMs: 1000, maxFrameGapMedianMs: 250, scope: 'この記録の基準環境・通常表示・各ケース3回の中央値。全文編集と文字の形の全表示を除外。' } } : {}),
  };
  const save = async () => {
    if (outputPath) await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  };
  /**
   * 試行ごとに新しいページを開くため、途中で dist がビルドし直されると、別の成果物の試行が同じ集計に混ざる。
   * 毎回の試行の後で dist を読み直して照合し、変わっていたら計測を止めて記録全体を無効にする（ビルド中で読めない場合も同じ）
   */
  const buildUnchanged = async () => {
    const current = await distBuild().then(({ distSha256 }) => distSha256, () => null);
    if (current === build.distSha256) return true;
    report.invalid = '計測中に dist が変わったため、この記録の値は比較に使えません';
    build.changedDuring = { distSha256: current, detectedAt: new Date().toISOString() };
    return false;
  };
  let changed = false;
  measuring: for (const rows of countRenderProfile ? [10_000] : passwordOnly ? [0] : subnetOnly ? [100_000] : ROWS) {
    for (const c of countDiagnosticsOnly ? COUNT_DIAGNOSTIC_CASES : passwordOnly ? PASSWORD_CASES : subnetOnly ? SUBNET_CASES : diffOnly ? CASES.filter((c) => c.tool === 'diff') : CASES) {
      const target = c.mode ? { tool: c.tool, mode: c.mode } : { tool: c.tool };
      const shape = countDiagnosticsOnly ? { alphabet: c.alphabet, codePoints: rows, distinctSymbols: c.alphabet === 'repeated' ? 1 : rows, inputUtf16: rows * 2, ...(c.renderMode ? { renderMode: c.renderMode } : {}) }
        : passwordOnly ? c.shape : { rows, lineUnits: c.line.length, sample: c.line };
      const expected = c.expected?.(rows) ?? 'result';
      const runs = [];
      let inputUnits = 0;
      try {
        for (let i = 0; i < RUNS_PER_CASE; i++) {
          /** 試行が失敗しても照合する（ビルドの入れ替えで失敗した場合も、原因を記録に残すため） */
          const measured = await measureOnce(browser, c, rows, c.line).finally(async () => { changed = !(await buildUnchanged()); });
          if (changed) throw Object.assign(new Error('計測中に dist が変わりました'), { name: 'BuildChanged' });
          inputUnits = measured.inputUnits;
          runs.push(measured.sample);
          if (measured.sample.outcome !== expected) {
            throw Object.assign(new Error(`期待した終了状態は ${expected} ですが、${measured.sample.outcome} で終わりました`), { name: 'UnexpectedOutcome' });
          }
        }
        results.push({
          ...target,
          shape: { ...shape, inputUnits },
          expected,
          outcome: expected,
          inputToResultMs: summarize(runs.map((r) => r.inputToResultMs)),
          maxFrameGapMs: summarize(runs.map((r) => r.maxFrameGapMs)),
          runs,
        });
        if (countBudget) {
          const result = results.at(-1);
          result.budgetPassed = result.inputToResultMs.median <= report.budget.inputToResultMedianMs && result.maxFrameGapMs.median <= report.budget.maxFrameGapMedianMs;
          if (!result.budgetPassed) process.exitCode = 1;
        }
      } catch (error) {
        const name = changed ? 'BuildChanged' : error.name;
        const message = changed ? '計測中に dist が変わりました' : String(error.message).split('\n')[0];
        results.push({ ...target, shape, expected, error: name, message, runs });
        process.exitCode = 1;
      }
      console.log(JSON.stringify({ ...results.at(-1), runs: undefined }));
      await save();
      if (changed) {
        console.error(report.invalid);
        break measuring;
      }
    }
  }
  await save();
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
