/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 設定・opener：不正設定からの復旧、有効設定の保持、opener解除と独立したタブへの案内
 * - 表示設定の保存：生成できない途中のパスワード設定を保存せず、再読み込みで直前の有効な設定に戻すこと。別タブで変えた設定を、無関係な操作や再描画で古い値に書き戻さないこと。最近使ったツールの更新で、別タブで開いたツールを消さないこと
 */
import { expect, test } from '@playwright/test';
import { CROSS_BROWSER } from './tags';

test('不正な表示設定を既定値に戻してパスワードを生成する', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dev-toolbox:pref:recent', JSON.stringify({ invalid: true }));
    localStorage.setItem('dev-toolbox:pref:password:mode', JSON.stringify('invalid'));
    localStorage.setItem('dev-toolbox:pref:password:options', JSON.stringify({ length: 16, symbolSet: 123 }));
    localStorage.setItem('dev-toolbox:pref:password:count', JSON.stringify(100000000));
    localStorage.setItem('dev-toolbox:pref:password:pin', JSON.stringify(3));
  });
  await page.goto('./#/password');
  await expect(page.getByRole('heading', { name: 'パスワード生成', exact: true })).toBeVisible();
  await expect(page.getByLabel('長さ（数値）', { exact: true })).toHaveValue('16');
  await expect(page.getByRole('combobox', { name: '生成数', exact: true })).toHaveValue('5');
  await expect(page.locator('.value-text')).toHaveCount(5);
  for (const text of await page.locator('.value-text').allTextContents()) expect([...text]).toHaveLength(16);
  await page.getByRole('button', { name: 'PIN（数字のみ）', exact: true }).click();
  /** 件数は切替前と同じなので、非同期の再生成が済んだことを内容まで待って確かめる。 */
  await expect(page.locator('.value-text')).toHaveText(Array(5).fill(/^\d{6}$/));
  /** 不正な保存値は除去され、次の通常起動にも持ち越さない。 */
  expect(await page.evaluate(() => localStorage.getItem('dev-toolbox:pref:password:options'))).toBeNull();
});

test('曜日・タイムゾーン・UUIDの壊れた設定でも画面を開ける', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    const values: Record<string, unknown> = {
      'bizdays:weekend': 'not-an-array',
      'time:zones': ['UTC', { invalid: true }],
      'time:zone': 123,
      'uuid:count': 100000000,
      'uuid:kind': 'invalid',
    };
    for (const [key, value] of Object.entries(values)) localStorage.setItem(`dev-toolbox:pref:${key}`, JSON.stringify(value));
  });
  for (const [id, name] of [['bizdays', '営業日計算'], ['time', 'UNIX時間変換'], ['uuid', 'UUID / ULID']]) {
    await page.goto(`./#/${id}`);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '画面を表示できません' })).toHaveCount(0);
  }
  await expect(page.getByRole('combobox', { name: '生成数', exact: true })).toHaveValue('5');
});

test('利用者が選んだ有効なパスワード設定は維持する', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dev-toolbox:pref:password:options', JSON.stringify({
      length: 24, upper: true, lower: true, digits: true, symbols: false,
      symbolSet: '', exclude: '', excludeAmbiguous: true, requireEach: true,
    }));
    localStorage.setItem('dev-toolbox:pref:password:count', '10');
  });
  await page.goto('./#/password');
  await expect(page.getByLabel('長さ（数値）', { exact: true })).toHaveValue('24');
  await expect(page.locator('.value-text')).toHaveCount(10);
  for (const text of await page.locator('.value-text').allTextContents()) expect(text).toMatch(/^[A-Za-z0-9]{24}$/);
});

test('生成できない途中の設定は保存せず、再読み込みで直前の有効な設定に戻す', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dev-toolbox:pref:password:options', JSON.stringify({
      length: 24, upper: true, lower: true, digits: true, symbols: false,
      symbolSet: '', exclude: 'xyz', excludeAmbiguous: true, requireEach: true,
    }));
  });
  await page.goto('./#/password');
  await expect(page.getByLabel('長さ（数値）', { exact: true })).toHaveValue('24');
  const option = () => page.evaluate(() => JSON.parse(localStorage.getItem('dev-toolbox:pref:password:options') ?? 'null'));
  /** 数字だけの設定は有効なので保存する */
  for (const name of ['英大文字', '英小文字']) {
    await page.getByRole('checkbox', { name: new RegExp(`^${name}`) }).uncheck();
  }
  await expect.poll(option).toMatchObject({ upper: false, lower: false, digits: true });
  const saved = await page.evaluate(() => localStorage.getItem('dev-toolbox:pref:password:options'));
  await page.getByRole('checkbox', { name: /^数字/ }).uncheck();
  await expect(page.getByText('使用できる文字がありません', { exact: false })).toBeVisible();
  /** 文字種をすべて外した状態は復元時の検証を通らないため、保存値は直前の有効な設定のまま */
  expect(await page.evaluate(() => localStorage.getItem('dev-toolbox:pref:password:options'))).toBe(saved);
  await page.reload();
  await expect(page.getByLabel('長さ（数値）', { exact: true })).toHaveValue('24');
  await expect(page.getByRole('checkbox', { name: /^数字/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^英大文字/ })).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: '除外する文字', exact: true })).toHaveValue('xyz');
});

test('別タブで変えた表示設定を、無関係な操作や再描画で古い値に書き戻さない', CROSS_BROWSER, async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('./#/bizdays');
  await b.goto('./#/bizdays');
  const weekend = (page: typeof a) => page.evaluate(() => localStorage.getItem('dev-toolbox:pref:bizdays:weekend'));
  await b.locator('label.day-toggle', { hasText: '水' }).click();
  await expect.poll(() => weekend(b)).toBe('[0,3,6]');
  /** A の計算の種類の切り替え（別の設定の保存と再描画）では、A が持つ古い曜日を書かない */
  await a.getByRole('button', { name: 'n営業日後', exact: true }).click();
  await expect.poll(() => a.evaluate(() => localStorage.getItem('dev-toolbox:pref:bizdays:tab'))).toBe('"add"');
  expect(await weekend(a)).toBe('[0,3,6]');
  /** A で曜日を変えたときは、A の画面の値で保存する */
  await a.locator('label.day-toggle', { hasText: '金' }).click();
  await expect.poll(() => weekend(a)).toBe('[0,5,6]');
});

test('回帰：最近使ったツールを、別タブで開いたツールを消さずに更新する', CROSS_BROWSER, async ({ context }) => {
  /** 別タブの変更を受け取らない設定の更新関数が、このタブの古い一覧に適用され、別タブで開いたツールを上書きしていた */
  const a = await context.newPage();
  const b = await context.newPage();
  const recent = () => a.evaluate(() => JSON.parse(localStorage.getItem('dev-toolbox:pref:recent') ?? '[]') as string[]);
  await a.goto('./');
  await b.goto('./');
  await a.goto('./#/json');
  await expect.poll(recent).toEqual(['json']);
  /** B は A の変更を受け取っていない（一覧は空のまま）が、保存値を読み直してから先頭に足す */
  await b.goto('./#/base64');
  await expect.poll(recent).toEqual(['base64', 'json']);
});

test('openerがあるタブでは入力せず、参照のない新しいタブで開き直せる', CROSS_BROWSER, async ({ page, context, baseURL }) => {
  await context.route('http://opener.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>検証用ページ</p>' }));
  await page.goto('http://opener.test/');
  const opened = page.waitForEvent('popup');
  const reference = await page.evaluateHandle((url) => window.open(url), `${baseURL}#/json`);
  const popup = await opened;
  await expect(popup.getByRole('heading', { name: '新しいタブで開き直してください' })).toBeVisible();
  await expect(popup.getByRole('textbox')).toHaveCount(0);
  await expect(popup.locator('.privacy')).toHaveCount(0);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  const reopened = popup.waitForEvent('popup');
  await popup.getByRole('link', { name: 'Dev Toolbox を新しいタブで開く' }).click();
  const safe = await reopened;
  await expect(safe.getByRole('heading', { name: 'JSON整形', exact: true })).toBeVisible();
  expect(await safe.evaluate(() => window.opener === null)).toBe(true);
  /** 解除後の移動権限はブラウザに依存しても、開き直したタブには影響しない。 */
  const moved = await reference.evaluate((target) => {
    try {
      target!.location.href = 'http://opener.test/replaced';
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') return false;
      throw error;
    }
  });
  if (moved) await expect(popup).toHaveURL('http://opener.test/replaced');
  else await expect(popup.getByRole('heading', { name: '新しいタブで開き直してください' })).toBeVisible();
  await expect(safe.getByRole('heading', { name: 'JSON整形', exact: true })).toBeVisible();
  await reference.dispose();
});
