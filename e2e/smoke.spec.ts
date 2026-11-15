/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 全ツールの表示：ツールの一覧（src/toolCatalog.ts）の全項目の見出し、外部通信・CSP違反・実行時エラー
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { TOOLS, settleRendering } from './app';

for (const [id, title] of TOOLS) {
  test(`${title} が表示され、エラー・CSP違反・外部通信がない`, CROSS_BROWSER, async ({ page }) => {
    await page.goto(`./#/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    const calculation = page.locator('[data-calculation-state]');
    if (await calculation.count()) await expect(calculation).toHaveAttribute('data-calculation-state', 'done');
    await settleRendering(page);
  });
}
