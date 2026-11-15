/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - Kubernetesのcron式：単一値からの間隔、?、曜日の範囲、日と曜日のORを検証し、標準形式との差と再読み込み後の形式を保つこと。Date の上限の直前を基準にしても、範囲外の候補を試し続けずに探索を終えること（あわせて `src/tools/cron/logic.test.ts`）
 * - Date の範囲より前の現地日付 × cron の曜日判定：最初の実行を飛ばさず、現地日付と日本時間の曜日を表示する（あわせて `src/lib/time/date.test.ts`・`src/tools/cron/logic.test.ts`）
 */
import { expect, test } from './fixtures';
import { type Page } from '@playwright/test';
import { CROSS_BROWSER } from './tags';


const expression = (page: Page) => page.getByRole('textbox', { name: 'cron式', exact: true });
const runs = (page: Page) => page.getByRole('table', { name: '次回の実行日時' }).getByRole('row');
const breakdown = (page: Page) => page.getByRole('table', { name: '項目ごとの内訳' });
const selectDialect = (page: Page, name: 'Quartz' | 'EventBridge' | 'Kubernetes') =>
  page.getByRole('group', { name: '形式' }).getByRole('button', { name, exact: true }).click();

test('cron式：日時の下限付近でも現地日付の最初の実行と曜日を表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/cron');
  await page.getByLabel('式を読むタイムゾーン', { exact: true }).selectOption('America/Phoenix');
  await page.getByLabel('基準日時', { exact: true }).fill('-271821-04-20T00:00:00.000Z');
  await expression(page).fill('0 17 * * *');
  await expect(runs(page).nth(1)).toContainText('-271821-04-19 17:00:00（月）');
  await expect(runs(page).nth(1)).toContainText('-271821-04-20 09:47:17（火）');
});

test('cron式：Quartz の第n曜日・月末・最も近い平日を読み下し、次回の実行日時を出す', async ({ page }) => {
  await page.goto('./#/cron');
  await selectDialect(page, 'Quartz');
  await page.getByRole('textbox', { name: '基準日時', exact: true }).fill('2026-10-01 00:00');

  await expression(page).fill('0 30 9 ? * MON#2');
  await expect(page.getByText('毎月第2月曜日 09:30', { exact: true })).toBeVisible();
  await expect(breakdown(page).getByRole('row', { name: /^曜日/ })).toContainText('第2月曜日');
  await expect(runs(page).nth(1)).toContainText('2026-10-12 09:30:00（月）');
  await expect(runs(page).nth(2)).toContainText('2026-11-09 09:30:00（月）');
  await expect(runs(page).nth(3)).toContainText('2026-12-14 09:30:00（月）');

  await expression(page).fill('0 0 18 L * ?');
  await expect(page.getByText('毎月月末 18:00', { exact: true })).toBeVisible();
  await expect(runs(page).nth(1)).toContainText('2026-10-31 18:00:00（土）');
  await expect(runs(page).nth(2)).toContainText('2026-11-30 18:00:00（月）');

  /** 31日が土曜なら30日（金）。31日がない11月は実行しない。2027年1月31日は日曜で月末なので29日（金） */
  await expression(page).fill('0 0 0 31W * ?');
  await expect(page.getByText('31日がない月には実行されません')).toBeVisible();
  await expect(runs(page).nth(1)).toContainText('2026-10-30 00:00:00（金）');
  await expect(runs(page).nth(2)).toContainText('2026-12-31 00:00:00（木）');
  await expect(runs(page).nth(3)).toContainText('2027-01-29 00:00:00（金）');

  await expression(page).fill('0 0 9 * * *');
  await expect(page.getByRole('alert')).toHaveText('日と曜日のどちらか一方だけを ? にしてください');
  await expression(page).fill('0 0 9 * *');
  await expect(page.getByRole('alert')).toContainText('6項目、または末尾に年を足した7項目です（5項目あります）');
});

test('cron式：EventBridge は cron(...) の書き方と年を読み、UTC の式を JST でも表示する', async ({ page }) => {
  await page.goto('./#/cron');
  await selectDialect(page, 'EventBridge');
  await page.getByLabel('式を読むタイムゾーン', { exact: true }).selectOption('UTC');
  await page.getByRole('textbox', { name: '基準日時', exact: true }).fill('2026-10-02 12:00');

  await expression(page).fill('cron(0 9 ? * MON-FRI *)');
  await expect(page.getByText('毎週月〜金曜日 09:00', { exact: true })).toBeVisible();
  /** 基準日時は JST の 12:00（UTC の 03:00）。同じ日の UTC 09:00 が最初 */
  await expect(runs(page).nth(1)).toContainText('2026-10-02 18:00:00（金）');
  await expect(runs(page).nth(1)).toContainText('2026-10-02 09:00:00（金）');
  await expect(runs(page).nth(2)).toContainText('2026-10-05 18:00:00（月）');

  await expression(page).fill('0 12 L * ? 2027');
  await expect(page.getByText('2027年の月末 12:00', { exact: true })).toBeVisible();
  await expect(runs(page).nth(1)).toContainText('2027-01-31 21:00:00（日）');
  await expect(runs(page).nth(2)).toContainText('2027-02-28 21:00:00（日）');

  await expression(page).fill('@daily');
  await expect(page.getByRole('alert')).toHaveText('@daily などのマクロは標準の cron と Kubernetes で使えます');
});

test('cron式：Kubernetes の単一値からの間隔を計算し、形式を再読み込み後も保つ', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/cron');
  await selectDialect(page, 'Kubernetes');
  await page.getByRole('textbox', { name: '基準日時', exact: true }).fill('2026-10-02 09:00');
  await expression(page).fill('5/15 * * * *');
  await expect(runs(page).nth(1)).toContainText('2026-10-02 09:05:00（金）');
  await expect(runs(page).nth(2)).toContainText('2026-10-02 09:20:00（金）');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Kubernetes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(runs(page).nth(1)).toContainText('2026-10-02 09:05:00（金）');
  await page.getByRole('button', { name: '標準（5項目）', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('5-59/15');
});

test('cron式：基準日時を消すと、止まっていた時刻ではなく現在時刻から次回の実行日時を計算する', async ({ page }) => {
  /** 2026-10-05 09:00（JST）に開く */
  await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
  await page.goto('./#/cron');
  await expression(page).fill('* * * * *');
  await expect(runs(page).nth(1)).toContainText('2026-10-05 09:01:00（月）');
  const base = page.getByRole('textbox', { name: '基準日時', exact: true });
  await base.fill('2026-10-05 09:30');
  await expect(runs(page).nth(1)).toContainText('2026-10-05 09:31:00（月）');
  /** 基準日時を入れている間に1時間進め、10:00 に基準日時を消す */
  await page.clock.fastForward('01:00:00');
  await base.fill('');
  await expect(runs(page).nth(1)).toContainText('2026-10-05 10:01:00（月）');
});

test('cron式：意味と次回の実行日時を JST で表示し、式を読むタイムゾーンを切り替えられる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/cron');
  await page.getByRole('textbox', { name: 'cron式', exact: true }).fill('0 9 * * 1-5');
  await page.getByRole('textbox', { name: '基準日時', exact: true }).fill('2026-10-02 12:00');
  await expect(page.getByText('毎週月〜金曜日 09:00', { exact: true })).toBeVisible();
  const runs = page.getByRole('table', { name: '次回の実行日時' });
  await expect(runs.getByRole('row').nth(1)).toContainText('2026-10-05 09:00:00（月）');

  await page.getByLabel('式を読むタイムゾーン', { exact: true }).selectOption('UTC');
  await expect(runs.getByRole('row').nth(1)).toContainText('2026-10-02 18:00:00（金）');
  await expect(runs.getByRole('row').nth(1)).toContainText('2026-10-02 09:00:00');

  await page.getByRole('group', { name: '形式' }).getByRole('button', { name: 'EventBridge', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('6項目');
  await page.getByRole('textbox', { name: 'cron式', exact: true }).fill('0 0 31 2 ? *');
  await expect(page.getByText('200年先まで探しましたが', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'cron式', exact: true })).toHaveValue('0 0 31 2 ? *');
});
