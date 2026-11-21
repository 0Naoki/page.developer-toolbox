/** CSS比較で使う配信・状態の収集・比較判定。ブラウザの起動とCLIから独立して検査する。 */
import { resolve } from 'node:path';
import { preview } from 'vite';

/** ビルドの中だけを配信する。ハッシュで画面を切り替えるため、未知のパスにHTMLを返す必要はない。 */
export async function serveStyleBuild(dir) {
  const instance = await preview({
    configFile: false, base: '/', appType: 'mpa', publicDir: false,
    build: { outDir: resolve(dir) },
    preview: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'reject-malformed-style-url',
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          try { decodeURIComponent(req.url ?? '/'); }
          catch { res.statusCode = 400; res.end(); return; }
          next();
        });
      },
    }],
  });
  const server = instance.httpServer;
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

/** 初期状態をサンプル投入前に記録し、その後のサンプルと切り替えも別のキーで残す。 */
export async function captureStyleStates(page, name, capture, ignore) {
  const states = { [`${name} 初期`]: await page.evaluate(capture, ignore) };
  const sample = page.getByRole('button', { name: 'サンプル', exact: true });
  if (await sample.count()) {
    await sample.first().click();
    await page.waitForTimeout(800);
    states[`${name} サンプル`] = await page.evaluate(capture, ignore);
  }
  const groups = page.locator('main [role="group"]');
  const visited = new Set();
  /** 親を次へ切り替える前に、その状態で現れる子も押す。同じ切り替えは1回だけ試し、全組合せには広げない。 */
  const visit = async (from) => {
    for (let g = from; g < (await groups.count()); g++) {
      const group = groups.nth(g);
      const groupName = await group.getAttribute('aria-label');
      const buttons = group.locator('button');
      const labels = await buttons.allTextContents();
      for (let b = 0; b < labels.length; b++) {
        const label = labels[b].trim();
        const key = JSON.stringify([groupName, labels, b]);
        if (visited.has(key)) continue;
        const button = buttons.nth(b);
        if (!(await button.isVisible()) || !(await button.isEnabled())) continue;
        visited.add(key);
        await button.click();
        await page.waitForTimeout(500);
        states[`${name} [${groupName}] ${label}`] = await page.evaluate(capture, ignore);
        await visit(g + 1);
      }
    }
  };
  await visit(0);
  return states;
}

/** 状態・要素のキーの和集合を調べる。変更後だけにあるキーも差分として扱う。 */
export function compareSnapshots(before, after) {
  let elements = 0;
  const differences = [];
  const states = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const state of states) {
    const a = before[state], b = after[state];
    if (!a || !b) {
      differences.push(`${state}：${a ? '変更後' : '変更前'}にこの状態がありません`);
      continue;
    }
    for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
      elements++;
      const x = a[path], y = b[path];
      if (!x || !y) differences.push(`${state} ${path}：${x ? '変更後' : '変更前'}にこの要素がありません`);
      else if (x.hash !== y.hash) differences.push(`${state} ${path}（.${x.cls || '(クラスなし)'}）：計算後のスタイルが違います`);
    }
  }
  return { states: states.size, elements, differences };
}
