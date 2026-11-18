/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 大容量入力とIME：50,000単位の境界でも確定全文を保持する。
 *   Chromium のネイティブIMEイベントで確定・取消・保存・Undo/Redoを確認する。
 *   3ブラウザでは終了前後の最終inputを模擬する。OSの実IMEの候補選択・キー操作を検証するものではない。
 */
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { paste } from './paste';

/** 通常の表示上限をまたぐ入力で、確定と取消を検査する。 */
const boundaries = [{ name: '50,000単位', base: 'a'.repeat(49_999), preedit: 'にほ', committed: '日本' }];

/** 表示を切り詰めた後も、全文編集・保存・履歴には確定文字が残ることを確認する。 */
async function checkCommitted(input: Locator, base: string, committed = '日本') {
  const page = input.page();
  const stored = () => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'));
  await expect.poll(stored).toBe(base + committed);
  await expect(input).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await expect(input).toHaveValue((base + committed).replace(/\r\n?/g, '\n'));
  await input.press('Control+z');
  await expect.poll(stored).toBe(base);
  await input.press('Control+Shift+z');
  await expect.poll(stored).toBe(base + committed);
  /** Undoで上限以内へ戻ると通常表示に戻るので、Redo後の全文表示は再度選ぶ。 */
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await expect(input).toHaveValue((base + committed).replace(/\r\n?/g, '\n'));
}

for (const boundary of boundaries) {
  test(`ネイティブIME：${boundary.name}で確定・取消・保存・履歴を保持する`, async ({ page, context }) => {
    await page.goto('./#/count');
    const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
    await input.fill(boundary.base);
    await input.evaluate((node: HTMLTextAreaElement) => { node.focus(); node.setSelectionRange(node.value.length, node.value.length); });
    const cdp = await context.newCDPSession(page);
    try {
      const composing = () => cdp.send('Input.imeSetComposition', { text: boundary.preedit, selectionStart: boundary.preedit.length, selectionEnd: boundary.preedit.length });
      await cdp.send('Input.imeSetComposition', { text: boundary.preedit.slice(0, -1), selectionStart: boundary.preedit.length - 1, selectionEnd: boundary.preedit.length - 1 });
      await composing();
      await expect(input).toBeEditable();
      await expect(input).toHaveValue(boundary.base + boundary.preedit);
      /** 空の変換で未確定文字だけを取り消す。 */
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
      await expect(input).toHaveValue(boundary.base);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe(boundary.base);
      await composing();
      await cdp.send('Input.insertText', { text: boundary.committed });
      await checkCommitted(input, boundary.base, boundary.committed);
    } finally {
      await cdp.detach();
    }
  });
}

for (const intermediate of [true, false]) {
  test(`IMEイベント模擬：途中input${intermediate ? 'あり' : 'なし'}で終了後にDOMが確定しても履歴を保持する`, CROSS_BROWSER, async ({ page }) => {
    await page.goto('./#/count');
    const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
    const base = 'a'.repeat(49_999);
    await input.fill(base);
    await input.dispatchEvent('compositionstart', { data: '' });
    await input.evaluate((node: HTMLTextAreaElement, intermediate) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      if (intermediate) {
        set.call(node, node.value + 'にほ');
        node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }));
      }
    }, intermediate);
    await input.evaluate((node: HTMLTextAreaElement, intermediate) => {
      /** compositionendの時点ではまだ途中のDOM値で、直後のinputが初めて確定値を知らせる順序。 */
      node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(node, (intermediate ? node.value.slice(0, -2) : node.value) + '日本');
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '日本' }));
    }, intermediate);
    await checkCommitted(input, base);
  });
}

for (const order of ['終了前', '終了後'] as const) {
  test(`IMEイベント模擬：${order}の最終inputを確定全文と履歴へ反映する`, CROSS_BROWSER, async ({ page }) => {
    await page.goto('./#/count');
    const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
    const base = 'x\r\ny' + 'a'.repeat(49_995);
    await paste(input, base);
    await input.evaluate((node: HTMLTextAreaElement) => { node.focus(); node.setSelectionRange(node.value.length, node.value.length); });
    await input.dispatchEvent('compositionstart', { data: '' });
    /** Reactの値追跡を通して、ブラウザが変更したDOM値とネイティブinputを模擬する。 */
    await input.evaluate((node: HTMLTextAreaElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(node, node.value + 'にほ');
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: 'にほ' }));
    });
    await expect(input).toBeEditable();
    await expect(input).toHaveValue(base.replace(/\r\n?/g, '\n') + 'にほ');
    await input.evaluate((node: HTMLTextAreaElement, order) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(node, node.value.slice(0, -2) + '日本');
      const end = () => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
      const final = () => node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '日本' }));
      if (order === '終了後') end();
      final();
      if (order === '終了前') end();
    }, order);
    await checkCommitted(input, base);
  });
}

test('IMEイベント模擬：変換中のクリアで変換状態と履歴を破棄する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await input.fill('a'.repeat(49_999));
  await input.dispatchEvent('compositionstart', { data: '' });
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  /** 置換後に古い終了イベントが届いても、変換中の値を復活させない。 */
  await input.dispatchEvent('compositionend', { data: '日本' });
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  await input.fill('新しい入力');
  await input.press('Control+z');
  await expect(input).toHaveValue('');
});
