/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R005] スマートフォンのメニュー：追従ヘッダーからツールを選ぶと閉じて本文へ移ること、検索から戻れること、IMEのEscapeを無視すること、外側の操作や同じツールの選択で閉じること、小さい画面でも保存設定までスクロールできること
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { settleRendering } from './app';

test('SPメニュー：追従ヘッダーからツールを選ぶと閉じ、本文へ移る', CROSS_BROWSER, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('./#/password');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('パスワード生成');
  const toggle = page.locator('.menu-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('navigation', { name: 'ツール一覧' })).toBeHidden();
  await expect(page.locator('.privacy')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(toggle).toBeInViewport();
  expect(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('navigation').getByRole('link', { name: 'Base64 / URLエンコード', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Base64 / URLエンコード');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
});

test('SPメニュー：検索から戻れる・IMEのEscapeは無視・外側の操作で閉じる', CROSS_BROWSER, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('./#/json');
  const toggle = page.locator('.menu-toggle');
  await toggle.click();
  const search = page.locator('.search-trigger');
  await search.click();
  await expect(page.getByRole('combobox', { name: 'ツールを検索' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await search.evaluate((el) => {
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', ...init }));
    }
  });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.locator('main h1').evaluate((el: HTMLElement) => { el.tabIndex = -1; el.focus(); });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(toggle).toBeHidden();
  await expect(page.getByRole('navigation')).toBeVisible();
  /**
   * 幅の変化（matchMedia の change）は描画の更新のときに届く。WebKit は描画しないうちに幅を戻すと、
   * 最初と最後の幅が同じなので一度も届かない。PC 幅で描画されるのを待ち、その時点で閉じていることを確かめる
   */
  await settleRendering(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('SPメニュー：小さい画面でも保存設定までスクロールでき、同じツールの選択でも閉じる', CROSS_BROWSER, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./#/password');
  const toggle = page.locator('.menu-toggle');
  await toggle.click();
  const clear = page.getByRole('button', { name: '保存データをすべて消去', exact: true });
  await clear.scrollIntoViewIfNeeded();
  await expect(clear).toBeInViewport();
  await expect(toggle).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('navigation').getByRole('link', { name: 'パスワード生成', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
});
