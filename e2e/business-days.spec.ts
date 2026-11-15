/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 営業日の期間集計：両端を含む日数と休日の内訳が逆順でも一致すること。独自休日・祝日・年末年始・週末の理由の優先順位を保ち、週末だけの休みを内訳から除くこと。期間と祝日の計算範囲を守ること。休みの内訳が多くても（30年の毎日を独自休日にすると10,958件）
 *   先頭100件だけを描画し、全件をコピーで取り出せること（あわせて `src/tools/business-days/logic.test.ts`）
 *   日本時間の年の変更で年の選択範囲を更新し、入力した日付は保つこと。
 */
import { expect, test } from './fixtures';
import { captureClipboard, copiedLines } from './clipboard';
import { pasteLargeInput } from './paste';
import { CROSS_BROWSER } from './tags';

test('営業日計算：年をまたぐと年の選択範囲を更新し、入力した日付を保つ', CROSS_BROWSER, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T14:58:00Z') });
  await page.goto('./#/bizdays');
  const from = page.getByLabel('開始日', { exact: true });
  await from.fill('2026-12-20');
  await page.getByRole('button', { name: '月ごとの営業日', exact: true }).click();
  const years = page.getByRole('combobox', { name: '年', exact: true });
  await expect(years.locator('option').last()).toHaveText('2036年');
  await page.clock.fastForward(120000);
  await expect(years.locator('option').last()).toHaveText('2037年');
  await page.getByRole('button', { name: '期間の営業日数', exact: true }).click();
  await expect(from).toHaveValue('2026-12-20');
});

test('営業日計算：逆順の期間でも営業日数と休日の内訳が一致する', async ({ page }) => {
  await page.goto('./#/bizdays');
  const from = page.getByLabel('開始日', { exact: true });
  const to = page.getByLabel('終了日', { exact: true });
  await from.fill('2026-01-01');
  await to.fill('2026-01-05');
  await page.getByLabel('年末年始（12/29〜1/3）を休みにする', { exact: true }).check();
  await page.getByLabel('会社独自の休日（1行に1日付）', { exact: true }).fill('2026-01-01');
  const stats = page.locator('.stats');
  const holidays = page.locator('.holiday-list li');
  await expect(stats).toContainText('営業日数1');
  await expect(stats).toContainText('暦日数5');
  await expect(stats).toContainText('休日数4');
  const expected = ['2026/01/01（木）独自休日', '2026/01/02（金）年末年始', '2026/01/03（土）年末年始'];
  await expect(holidays).toHaveText(expected);
  await from.fill('2026-01-05');
  await to.fill('2026-01-01');
  await expect(stats).toContainText('営業日数1');
  await expect(stats).toContainText('暦日数5');
  await expect(holidays).toHaveText(expected);
});

test('営業日計算：期間内の休みが多くても先頭100件だけを描画し、全件はコピーで取り出せる', async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/bizdays');
  await page.getByLabel('開始日', { exact: true }).fill('1996-01-01');
  await page.getByLabel('終了日', { exact: true }).fill('2025-12-31');
  /** 期間の毎日を独自休日にする（平日以外の休みは 10,958 件） */
  const days: string[] = [];
  for (let t = Date.UTC(1996, 0, 1); t <= Date.UTC(2025, 11, 31); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  await pasteLargeInput(page, '会社独自の休日（1行に1日付）', days.join('\n'));
  await expect(page.locator('.holiday-list li')).toHaveCount(100);
  await expect(page.getByText('ほか 10,858 件（先頭 100 件を表示）', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'すべての休みをコピー', exact: true }).click();
  await expect.poll(() => copiedLines(page)).toBe(10_958);
});
