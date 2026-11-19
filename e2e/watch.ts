import type { BrowserContext, Page } from '@playwright/test';

/**
 * 外部への通信・CSP 違反・実行時エラーの監視（e2e/fixtures.ts の test が、すべてのケースで使う）。
 * ブラウザ自身の既知の報告（アプリのコードではないもの）だけを、ブラウザごとに除外する。除外の範囲は広げない
 */

/**
 * WebKit は <select> の内部の部品にインラインのスタイルを使うため、<select> を置いただけで
 * style-src の CSP 違反を報告する（アプリのコードとは関係なく、<select> だけのページでも起きる）。
 * WebKit ではこの2つだけを除外する。アプリ自身のインラインのスタイルは Chromium の検査で見つかる
 *
 * WebKit では、失敗したテストのスクリーンショット（playwright.config.ts の screenshot: 'only-on-failure'）を撮るときにも、
 * Playwright がページに入れる <style> が「CSP違反: style-src-elem inline」として報告される。失敗の後にだけ出る二次的な報告なので、
 * 先に出た失敗の原因を調べる。アプリが <style> を入れた場合も同じ報告になるため、除外しない
 */
const WEBKIT_SELECT_CSP = [
  /^console: Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/,
  /^console: CSP違反: style-src-attr inline$/,
];

/**
 * WebKit は、blob: の URL から読み込み中の Worker を終了すると（入力が変わって古い計算を止めたときなど）、
 * 読み込みの失敗を「…due to access control checks.」というページのエラーとして報告する（失敗は再現しにくく、20〜60回に1〜3回）。
 * Worker を本当に起動できなかった場合は、画面に「計算を開始できません」を表示し、それぞれの E2E の検査で失敗するため、
 * 自分のオリジンの blob: の Worker についてのこのエラーだけを、WebKit で除外する
 */
const WEBKIT_TERMINATED_WORKER = /^pageerror: (?:Cannot load )?(?:blob:)?(h?ttps?:\/\/[^/]+)\/[0-9a-f-]{36} due to access control checks\.$/;

/**
 * Firefox では、同じく読み込み中の Worker を終了すると、Playwright の Firefox 用の内部のコード（chrome://juggler/…）が
 * NS_BINDING_ABORTED をコンソールのエラーとして報告することがある（アプリのコードではない）。Firefox でこの形だけを除外する
 */
const FIREFOX_TERMINATED_WORKER = /^console: \[JavaScript Error: "NS_BINDING_ABORTED: " \{file: "chrome:\/\/juggler\/content\/[^"]*" line: \d+\}\]$/;

/**
 * コンソールエラー・CSP違反・外部への通信を記録する。
 *
 * @remarks
 * コンテキストを渡すと、その中のすべてのタブ（テストの途中で context.newPage() で開いたタブや、リンクで開いたタブを含む）を監視する。
 * ページを渡すと、そのページだけを監視する（監視そのものを確かめるテストなど）。
 */
export async function watch(target: Page | BrowserContext, origin: string) {
  const problems: string[] = [];
  const isPage = (t: Page | BrowserContext): t is Page => 'mainFrame' in t;
  const context = isPage(target) ? target.context() : target;
  const browserName = context.browser()?.browserType().name();
  const isWebKit = browserName === 'webkit';
  const push = (problem: string) => {
    if (isWebKit) {
      const workerOrigin = WEBKIT_TERMINATED_WORKER.exec(problem)?.[1]?.replace(/^ttp:/, 'http:');
      if (workerOrigin === origin || WEBKIT_SELECT_CSP.some((re) => re.test(problem))) return;
    }
    if (browserName === 'firefox' && FIREFOX_TERMINATED_WORKER.test(problem)) return;
    problems.push(problem);
  };
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') push(`console: ${m.text()}`);
  };
  const onRequest = (r: { url(): string }) => {
    const url = new URL(r.url());
    /** blob: の Worker も、URL の origin は作成元のオリジンになる。 */
    if (url.origin !== origin) problems.push(`外部への通信: ${r.url()}`);
  };
  if (isPage(target)) {
    target.on('console', onConsole);
    target.on('pageerror', (e) => push(`pageerror: ${e.message}`));
    target.on('request', onRequest);
  } else {
    /** コンテキストのイベントは、すべてのタブ（後から開いたタブを含む）のものが届く */
    target.on('console', onConsole);
    target.on('weberror', (e) => push(`pageerror: ${e.error().message}`));
    target.on('request', onRequest);
  }
  await target.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP違反: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return problems;
}
