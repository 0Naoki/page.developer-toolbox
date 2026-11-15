/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 保存失敗・編集：容量超過時の退避・再保存、CRLFと選択範囲、Undo/Redo、画像貼り付け時の入力保持
 */
import { expect, test } from './fixtures';
import { paste } from './paste';
import { CROSS_BROWSER } from './tags';
import { downloadedText } from './files';
import { openNavigation } from './app';

for (const tool of ['json']) {
  test(`履歴リセット：${tool}は空欄のクリアと同じサンプルの再適用でも履歴を破棄する`, CROSS_BROWSER, async ({ page }) => {
    await page.goto(`./#/${tool}`);
    const input = page.getByRole('textbox', { name: '入力', exact: true });
    const undo = page.getByRole('button', { name: '元に戻す', exact: true });
    const redo = page.getByRole('button', { name: 'やり直す', exact: true });
    await input.fill('secret'); await input.fill('');
    await page.getByRole('button', { name: 'クリア', exact: true }).click();
    await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
    await input.press('Control+z'); await input.press('Control+Shift+z');
    await expect(input).toHaveValue('');
    expect(await page.evaluate((id) => sessionStorage.getItem(`dev-toolbox:input:${id}`), tool)).toBeNull();
    const sample = page.getByRole('button', { name: 'サンプル', exact: true });
    await sample.click(); const original = await input.inputValue();
    await input.press('End'); await input.press('Space'); await input.press('Control+z');
    await expect(input).toHaveValue(original); await expect(redo).toBeEnabled();
    await sample.click();
    await expect(undo).toBeDisabled(); await expect(redo).toBeDisabled();
    await input.press('Control+Shift+z'); await expect(input).toHaveValue(original);
  });
}

test('保存失敗：タブ内保持の失敗を通知し、全文を退避・再保存できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/json');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  await input.fill('{"old":1}');
  await page.evaluate(() => {
    document.documentElement.dataset.failInputSave = 'true';
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'dev-toolbox:input:json' && document.documentElement.dataset.failInputSave === 'true') {
        throw new DOMException('容量超過', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });
  const next = '{"new":2,"text":"未保存😀"}';
  await input.fill(next);
  await expect(page.getByRole('alert')).toContainText('未保存');
  await expect(input).toHaveValue(next);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '未保存の入力を保存', exact: true }).click();
  const download = await downloadEvent;
  expect(await downloadedText(download)).toBe(next);
  await page.evaluate(() => { delete document.documentElement.dataset.failInputSave; });
  await page.getByRole('button', { name: '保存を再試行', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(input).toHaveValue(next);
});

for (const tool of ['json']) {
  test(`貼り付け：${tool}の大容量CRLF入力を選択位置で置換する`, CROSS_BROWSER, async ({ page }) => {
    await page.goto(`./#/${tool}`);
    const input = page.getByRole('textbox', { name: '入力', exact: true });
    const original = 'first\r\nsecond\rthird\n' + 'z'.repeat(51_000);
    await paste(input, original);
    await page.getByRole('button', { name: '全文を編集', exact: true }).click();
    /** textarea の値では改行が LF になるため、その上での位置で選択する */
    const at = original.replace(/\r\n?/g, '\n').indexOf('third');
    await paste(input, 'X\r\nY', [at, at + 5]);
    expect(await page.evaluate((id) => sessionStorage.getItem(`dev-toolbox:input:${id}`), tool))
      .toBe(original.replace('third', 'X\r\nY'));
  });
}

test('貼り付け：JSON整形の大容量の貼り付けも、元に戻す・やり直すができる', CROSS_BROWSER, async ({ page }) => {
  /** 5万文字を超える貼り付けは部品が自分で入力を置き換える（ブラウザの編集履歴に残らない）ため、部品の履歴で戻す */
  await page.goto('./#/json');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const before = '{"before":1}';
  const big = `{"big":"${'z'.repeat(60_000)}"}`;
  const stored = () => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:json'));
  await input.fill(before);
  await paste(input, big, [0, before.length]);
  await expect.poll(stored).toBe(big);
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(input).toHaveValue(before);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect.poll(stored).toBe(big);
  /** キーボードでも戻せる */
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await input.press('Control+z');
  await expect(input).toHaveValue(before);
});

test('貼り付け：文字数画面で挿入直後の位置から続けて入力できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await input.fill('abcd');
  await paste(input, 'X\r\n😀', [1, 1]);
  await input.press('Y');
  await expect(input).toHaveValue('aX\n😀Ybcd');
  expect(await page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe('aX\r\n😀Ybcd');
});

test('クリア：空欄でもUndo・Redoの履歴を破棄する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await input.fill('secret');
  await input.fill('');
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'やり直す', exact: true })).toBeDisabled();
  await input.press('Control+z');
  await input.press('Control+Shift+z');
  await expect(input).toHaveValue('');
});

test('保存失敗：複数入力の失敗を個別に解除し、画面移動で退避用の参照を破棄する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/diff');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('dev-toolbox:input:diff:') && value.startsWith('fail')) throw new DOMException('容量超過', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('textbox', { name: '変更前', exact: true }).fill('fail-before');
  await page.getByRole('textbox', { name: '変更後', exact: true }).fill('fail-after');
  await expect(page.getByRole('button', { name: '未保存の入力1を保存', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '未保存の入力2を保存', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '変更前', exact: true }).fill('saved');
  await expect(page.getByRole('button', { name: '未保存の入力を保存', exact: true })).toBeVisible();
  await openNavigation(page);
  await page.getByRole('link', { name: 'JSON整形', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'JSON整形', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /未保存の入力.*を保存/ })).toHaveCount(0);
});
