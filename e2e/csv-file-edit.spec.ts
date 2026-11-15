/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - CSVの読込・編集：引用符内の改行を保った編集・Undo/Redo、文字コード不一致時の入力保持と読み直し
 */
import { expect, test } from './fixtures';
import { type Page } from '@playwright/test';
import { CROSS_BROWSER } from './tags';
import { pickFile } from './files';

async function openCsvFile(page: Page, content: string | number[]) {
  await pickFile(page, 'data.csv', content, 'text/csv');
}

test('CSV：別セルの編集・Undo・Redoでも引用符内のCRLFを保持する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  await openCsvFile(page, 'name,notes\r\na,"x\r\ny"');
  const output = page.getByRole('textbox', { name: '出力（JSON）', exact: true });
  await expect(output).toHaveValue(/"notes": "x\\r\\ny"/);
  const input = page.getByRole('textbox', { name: '入力（CSV）', exact: true });
  await input.focus();
  await input.press('Control+Home');
  await input.press('ArrowDown');
  await input.press('ArrowRight');
  await input.press('b');
  await expect(output).toHaveValue(/"name": "ab"/);
  await expect(output).toHaveValue(/"notes": "x\\r\\ny"/);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(output).toHaveValue(/"name": "a"/);
  await expect(output).toHaveValue(/"notes": "x\\r\\ny"/);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(output).toHaveValue(/"name": "ab"/);
  await expect(output).toHaveValue(/"notes": "x\\r\\ny"/);
});

test('CSV：文字コード不一致は既存入力を保持し、正しい文字コードで読み直せる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  const input = page.getByRole('textbox', { name: '入力（CSV）', exact: true });
  await input.fill('name\noriginal');
  const file = [0x6e, 0x61, 0x6d, 0x65, 10, 0x82, 0xa0];
  await openCsvFile(page, file);
  await expect(page.getByRole('alert')).toContainText('文字コード');
  await expect(input).toHaveValue('name\noriginal');
  await page.getByRole('combobox', { name: 'ファイルの文字コード' }).selectOption('shift_jis');
  await openCsvFile(page, file);
  await expect(input).toHaveValue('name\nあ');
  await expect(page.getByRole('textbox', { name: '出力（JSON）', exact: true })).toHaveValue(/"name": "あ"/);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
