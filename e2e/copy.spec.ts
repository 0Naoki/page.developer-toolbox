/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - コピー × 対象の変更・書き込みの遅延・拒否・連続操作：古い完了を新しい値に表示しない。失敗を知らせて再試行でき、前のタイマーで次の成功表示を消さない
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';

test('コピー：権限などで失敗したことを知らせ、再試行できる', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => ++attempts === 1 ? Promise.reject(new Error('denied')) : Promise.resolve(),
    } });
  });
  await page.goto('./#/time');
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）', { exact: true }).fill('1700000000');
  const row = page.locator('.pane').first().getByRole('row', { name: /^ISO8601/ });
  await row.getByRole('button', { name: 'コピー', exact: true }).click();
  await expect(row.locator('.error-text')).toContainText('コピーできませんでした');
  await row.getByRole('button', { name: 'コピー', exact: true }).click();
  await expect(row.getByRole('button')).toHaveText('コピーしました');
  await expect(row.locator('.error-text')).toHaveCount(0);
});

test('コピー：前の解除タイマーで次の成功表示を消さない', CROSS_BROWSER, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }));
  await page.goto('./#/time');
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）', { exact: true }).fill('1700000000');
  const button = page.locator('.pane').first().getByRole('row', { name: /^ISO8601/ }).getByRole('button');
  await expect(button).toBeVisible();
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await button.click();
  await expect(button).toHaveText('コピーしました');
  await page.clock.runFor(1000);
  await button.click();
  await expect(button).toHaveText('コピーしました');
  await page.clock.runFor(250);
  expect(await button.textContent()).toBe('コピーしました');
  await page.clock.runFor(950);
  await expect(button).toHaveText('コピー');
});

test('コピー：古い書き込みの完了を新しい出力に表示しない', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { finishCopy?: () => void; copiedText?: string };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: (text: string) => { state.copiedText = text; return new Promise<void>((resolve) => { state.finishCopy = resolve; }); },
    } });
  });
  await page.goto('./#/time');
  const input = page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）', { exact: true });
  const row = page.locator('.pane').first().getByRole('row', { name: /^ISO8601/ });
  await input.fill('1700000000');
  await expect(row).toContainText('2023-11-14T22:13:20.000Z');
  await row.getByRole('button', { name: 'コピー', exact: true }).click();
  await input.fill('1700000001');
  await expect(row).toContainText('2023-11-14T22:13:21.000Z');
  await page.evaluate(async () => {
    (window as unknown as { finishCopy: () => void }).finishCopy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await row.getByRole('button').textContent()).toBe('コピー');
  expect(await page.evaluate(() => (window as unknown as { copiedText: string }).copiedText)).toBe('2023-11-14T22:13:20.000Z');
});
