/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - CSP・埋め込み：通信・HTML挿入の拒否、iframe内で入力できないこと
 */
/** 拒否そのものを検査するケースは、期待するエラーを各ケース内で検証する。 */
import { test as probeTest } from '@playwright/test';
import { expect, test } from './fixtures';
import { watch } from './watch';
import { CROSS_BROWSER } from './tags';

probeTest('通信監視は同じホストでもプレビューと異なるポートを検出する', async ({ page, baseURL }) => {
  const preview = new URL(baseURL!);
  const other = new URL(preview);
  other.port = preview.port === '4180' ? '4181' : '4180';
  const problems = await watch(page, preview.origin);
  await page.goto(preview.href);
  await page.route(other.href, (route) => route.fulfill({ body: '通信監視の検査' }));
  await page.goto(other.href);
  expect(problems).toEqual([`外部への通信: ${other.href}`]);
});

test('本番ビルドに CSP が埋め込まれている', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).toContain('trusted-types dev-toolbox-regex-worker');
  expect(csp).toContain('dev-toolbox-calculation-worker');
  expect(csp).toContain('worker-src blob:');
  expect(csp).not.toContain("worker-src 'self'");
});

/**
 * URL から読み込んだ Worker には <meta> の CSP が適用されない。blob: の Worker がページの CSP を引き継ぎ、
 * Worker の中でも通信できないことを、アプリが実際に起動する Worker で確かめる
 */
for (const [name, path, start] of [
  ['正規表現', './#/regex', { label: '正規表現', text: 'a' }],
  ['JSON整形', './#/json', { label: '入力', text: '{"a":1}' }],
] as const) {
  probeTest(`CSP によって ${name}の Worker の中からの通信もブロックされる`, CROSS_BROWSER, async ({ page }) => {
    await page.addInitScript(() => {
      /**
       * Worker のコードの先頭に、通信できるかを調べる処理を足す（blob: の URL になるコードだけ）。
       * 同期の XMLHttpRequest で調べ、アプリの計算の結果より先に返す（結果を返すと Worker は終了するため）
       */
      const probe = `self.addEventListener('message', (e) => {
        if (e.data !== '__csp_probe__') return;
        e.stopImmediatePropagation();
        let result = 'ブロックされた';
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', self.location.origin + '/', false);
          xhr.send();
          result = '送信できてしまった';
        } catch {}
        self.postMessage({ cspProbe: result });
      });\n`;
      const NativeBlob = window.Blob;
      window.Blob = class extends NativeBlob {
        constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
          super(options?.type === 'text/javascript' ? [probe, ...(parts ?? [])] : parts, options);
        }
      };
      const results: string[] = [];
      (window as Window & { cspProbes?: string[] }).cspProbes = results;
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', (e) => {
            const data = e.data as { cspProbe?: string } | null;
            if (!data?.cspProbe) return;
            results.push(data.cspProbe);
            e.stopImmediatePropagation();
          });
          this.postMessage('__csp_probe__');
        }
      };
    });
    await page.goto(path);
    await page.getByRole('textbox', { name: start.label, exact: true }).fill(start.text);
    await page.waitForFunction(() => ((window as Window & { cspProbes?: string[] }).cspProbes?.length ?? 0) > 0);
    expect(await page.evaluate(() => (window as Window & { cspProbes?: string[] }).cspProbes)).toEqual(['ブロックされた']);
  });
}

probeTest('Worker 用の Trusted Types のポリシーは起動時に作られ、ほかのコードは同じ名前で作れない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  const results = await page.evaluate(() => {
    const types = (window as Window & { trustedTypes?: { createPolicy: (name: string, rules: object) => unknown } }).trustedTypes;
    if (!types) return null;
    return ['dev-toolbox-regex-worker', 'dev-toolbox-calculation-worker'].map((name) => {
      try {
        types.createPolicy(name, { createScriptURL: (url: string) => url });
        return '作れてしまった';
      } catch {
        return 'ブロックされた';
      }
    });
  });
  /** Trusted Types に対応していないブラウザでは、ポリシーそのものがない */
  if (results) expect(results).toEqual(['ブロックされた', 'ブロックされた']);
});

probeTest('Trusted Types によって HTML の文字列の挿入がブロックされる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(() => {
    const div = document.createElement('div');
    try {
      div.innerHTML = '<a href="https://example.com/">偽のリンク</a>';
      return '挿入できてしまった';
    } catch {
      return 'ブロックされた';
    }
  });
  expect(result).toBe('ブロックされた');
});

probeTest('CSP によって外部への通信がブロックされる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return '送信できてしまった';
    } catch {
      return 'ブロックされた';
    }
  });
  expect(result).toBe('ブロックされた');
});

test('ほかのページに埋め込まれると、アプリを表示せず別のタブで開くよう案内する', CROSS_BROWSER, async ({ page, baseURL }) => {
  /** 罠のサイトが透明にして重ねる代わりに、そのまま iframe で埋め込んだページを作る */
  await page.setContent(`<iframe src="${baseURL}#/json" width="1000" height="700"></iframe>`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { level: 1 })).toHaveText('別のタブで開いてください');
  await expect(frame.getByRole('link', { name: /dev-toolbox/ })).toHaveAttribute('target', '_blank');
  /** 押させたい部品（保存の設定・消去・入力欄）が1つもない */
  await expect(frame.locator('input, textarea, select, button')).toHaveCount(0);
});
