/**
 * CSS を整理したときに、見た目が変わっていないことを確かめる（画面を描画する単体テストがないため）。
 *
 * 使い方（docs/TESTING.md の「CSS を整理するときの見た目の比較」）：
 *   node scripts/compare-styles.mjs build before     変更前のソースをビルドする（.vite/compare-styles/before）
 *   node scripts/compare-styles.mjs build after      変更後のソースをビルドする（.vite/compare-styles/after）
 *   node scripts/compare-styles.mjs compare before after
 *
 * compare は次の2つを比べ、違いがあれば終了コード 1 で終わる。
 * - ビルドした CSS の規則の集まり（並びの違いは問わない。消えた規則・増えた規則・中身の変わった規則を表示する）
 * - 全ツールとトップページの、全要素の計算後のスタイル（PC 幅とスマートフォン幅。初期の状態・「サンプル」を押した状態・
 *   本文の切り替えボタン（role="group" の中のボタン）を1つずつ押した状態）
 *
 * 計算後のスタイルは、CSS の変数の列挙の順番が毎回変わるため、プロパティを並べてから比べる。
 * ランダムな出力（生成したパスワード）は、文字ごとの色分けで要素の数や種類が変わるため、IGNORE の中は比べない。
 * ダークテーマ・マウスを乗せたとき・フォーカス・エラーの状態は比べないので、必要なら目視で確かめる。
 */
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { captureStyleStates, compareSnapshots, serveStyleBuild } from './style-comparison.mjs';

const OUT_ROOT = '.vite/compare-styles';
/** ランダムな出力を並べる入れ物。中の要素は比べない（生成したパスワードは、文字の種類ごとに色分けした要素の数が毎回変わる） */
const IGNORE = ['.pw-list'];
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };

const [command, ...names] = process.argv.slice(2);
const dirOf = (name) => {
  if (!/^[\w-]+$/.test(name ?? '')) throw new Error(`ビルドの名前（before・after など）を指定してください：${name}`);
  return join(OUT_ROOT, name);
};

/** 一覧の順のツールの ID（src/toolCatalog.ts の id の並び） */
async function toolIds() {
  const catalog = await readFile('src/toolCatalog.ts', 'utf8');
  return [...catalog.matchAll(/^\s+id: '([^']+)',$/gm)].map((m) => m[1]);
}

/** ページの中で、全要素の計算後のスタイルをハッシュにする（キーは body からの要素の位置） */
function capture(ignore) {
  const hash = (text) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
  };
  const result = {};
  const walk = (el, path) => {
    const style = getComputedStyle(el);
    const parts = [];
    for (let i = 0; i < style.length; i++) parts.push(`${style[i]}:${style.getPropertyValue(style[i])}`);
    parts.sort();
    result[path] = { hash: hash(parts.join(';')), cls: typeof el.className === 'string' ? el.className : '' };
    if (ignore.some((selector) => el.matches(selector))) return;
    [...el.children].forEach((child, i) => walk(child, `${path}>${child.tagName.toLowerCase()}:${i}`));
  };
  walk(document.body, 'body');
  return result;
}

/** 全ツールとトップページの、状態ごとの計算後のスタイル */
async function snapshots(dir) {
  const { server, url } = await serveStyleBuild(dir);
  let browser;
  const out = {};
  try {
    browser = await chromium.launch();
    for (const [viewport, size] of Object.entries(VIEWPORTS)) {
      for (const id of ['', ...(await toolIds())]) {
        const page = await browser.newPage({ viewport: size });
        await page.goto(`${url}#/${id}`);
        await page.waitForTimeout(400);
        const name = `${viewport} ${id || '(トップページ)'}`;
        Object.assign(out, await captureStyleStates(page, name, capture, IGNORE));
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    server.close();
  }
  return out;
}

/** ビルドした CSS の規則（最も内側の { } の組。@media の中の規則も1つずつ） */
async function cssRules(dir) {
  const assets = join(dir, 'assets');
  const files = (await readdir(assets)).filter((f) => f.endsWith('.css'));
  const texts = await Promise.all(files.map((f) => readFile(join(assets, f), 'utf8')));
  return texts.flatMap((t) => t.match(/[^{}]+\{[^{}]*\}/g) ?? []).map((s) => s.trim()).sort();
}

async function compare(beforeName, afterName) {
  const [before, after] = [dirOf(beforeName), dirOf(afterName)];
  let failed = false;

  const [rulesBefore, rulesAfter] = await Promise.all([cssRules(before), cssRules(after)]);
  const removed = rulesBefore.filter((r) => !rulesAfter.includes(r));
  const added = rulesAfter.filter((r) => !rulesBefore.includes(r));
  console.log(`CSS の規則：変更前 ${rulesBefore.length} 件・変更後 ${rulesAfter.length} 件`);
  if (removed.length || added.length) {
    failed = true;
    for (const r of removed) console.log(`  - ${r}`);
    for (const r of added) console.log(`  + ${r}`);
  }

  const [a, b] = [await snapshots(before), await snapshots(after)];
  const { states, elements, differences: diffs } = compareSnapshots(a, b);
  console.log(`計算後のスタイル：${states} 状態・${elements} 要素`);
  if (diffs.length) {
    failed = true;
    for (const d of diffs.slice(0, 50)) console.log(`  ${d}`);
    if (diffs.length > 50) console.log(`  ほか ${diffs.length - 50} 件`);
  }
  console.log(failed ? '違いがあります' : '違いはありません');
  process.exitCode = failed ? 1 : 0;
}

if (command === 'build') {
  const outDir = dirOf(names[0]);
  await build({ logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  console.log(`${outDir} にビルドしました`);
} else if (command === 'compare') {
  await compare(names[0], names[1]);
} else {
  console.log('使い方：node scripts/compare-styles.mjs build <名前> ／ node scripts/compare-styles.mjs compare <変更前の名前> <変更後の名前>');
  process.exitCode = 2;
}
