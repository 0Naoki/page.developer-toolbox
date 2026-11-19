/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R018] 文字数・不可視文字：元の改行・位置、貼り付け境界での改行とカーソル位置、範囲外の上限と有効値の復元、表示切替とページ保持、遅い読み込みと後の編集の競合
 * - [R055] 省略された文字診断・不可視文字の集計・位置を全件コピー・保存し、入力変更後に旧結果を操作できない。
 * - [R051] 不完全なサロゲート × CR・LF・CRLF × 改行の数え方：別の行の文字を結合せず、行別の UTF-8 バイト数と設定した改行分を足した値が全体と一致する（あわせて `src/tools/text-count/logic.test.ts`）
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { paste, pasteImageOverAll, pasteLargeInput } from './paste';
import { pickFile } from './files';
import { captureClipboard, copiedText, copiedLines } from './clipboard';

/** 文字数・不可視文字・桁あふれの表示を切り替える */
async function selectCountView(page: Page, name: '文字数' | '不可視文字' | '桁あふれ') {
  await page.getByRole('group', { name: '表示する内容', exact: true }).getByRole('button', { name, exact: true }).click();
}

test('文字数：表示量を抑えても入力全文と診断を保持し、文字の形を追加表示できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await captureClipboard(page);
  const text = Array.from({ length: 10_000 }, (_, i) => String.fromCodePoint(0x10000 + i)).join('');
  await pasteLargeInput(page, 'テキスト', text);
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await expect(input).toHaveAttribute('readonly', '');
  expect((await input.inputValue()).length).toBeLessThanOrEqual(2000);
  await page.getByRole('button', { name: '入力全文をコピー', exact: true }).click();
  await expect.poll(() => copiedText(page)).toBe(text);
  const sjis = page.locator('.notice', { hasText: 'Shift_JIS で表現できない文字があります' });
  await expect(sjis.locator('.char-glyph')).toHaveCount(100);
  await expect(sjis.locator('.char-glyph').nth(5)).toHaveText('…');
  await sjis.getByRole('button', { name: 'Shift_JIS診断の文字の形をすべて表示', exact: true }).click();
  await expect(sjis.locator('.char-glyph').nth(99)).toHaveText(String.fromCodePoint(0x10000 + 99));
  await sjis.getByRole('button', { name: 'Shift_JIS診断の文字の形を先頭だけ表示', exact: true }).click();
  await expect(sjis.locator('.char-glyph').nth(5)).toHaveText('…');
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await expect(input).not.toHaveAttribute('readonly', '');
  await expect(input).toHaveValue(text);
});

test('文字診断：省略した種類も全件コピー・保存し、入力変更後は古い出力を操作できない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await captureClipboard(page);
  const chars = Array.from({ length: 201 }, (_, i) => String.fromCodePoint(0x10000 + i)).join('');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await input.fill(chars);
  await expect(page.getByText('ほか 101 種類')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Shift_JIS診断の全件をコピー', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shift_JIS診断の全件を保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Shift_JIS診断の全件を準備', exact: true }).click();
  const copy = page.getByRole('button', { name: 'Shift_JIS診断の全件をコピー', exact: true });
  await expect(copy).toBeEnabled();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Shift_JIS診断の全件を保存', exact: true }).click();
  const stream = await (await downloading).createReadStream();
  if (!stream) throw new Error('ダウンロード結果を読み取れません');
  const bytes: number[] = [];
  for await (const chunk of stream) for (const byte of chunk) bytes.push(byte);
  const saved = new TextDecoder().decode(new Uint8Array(bytes));
  expect(saved.split('\n')).toHaveLength(202);
  expect(saved).toContain('U+100C8');
  await copy.click();
  await expect.poll(() => copiedText(page)).toBe(saved);
  await input.fill('😀');
  await expect(page.getByRole('button', { name: 'Shift_JIS診断の全件をコピー', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shift_JIS診断の全件を保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Shift_JIS診断の全件を準備', exact: true }).click();
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect.poll(() => copiedLines(page)).toBe(2);
  await expect.poll(() => copiedText(page)).toContain('U+1F600');
});

test('不可視文字：2001件目の位置と100種類以降の集計を全件コピーする', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await captureClipboard(page);
  await selectCountView(page, '不可視文字');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await input.fill('\t'.repeat(2001));
  await expect(page.getByRole('table', { name: '不可視文字の出現位置', exact: true }).locator('tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: '不可視文字の出現位置の全件を準備', exact: true }).click();
  const copy = page.getByRole('button', { name: '不可視文字の出現位置の全件をコピー', exact: true });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect.poll(() => copiedLines(page)).toBe(2002);
  await expect.poll(() => copiedText(page)).toContain('1\t2001\t2000\tU+0009');
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await input.fill(Array.from({ length: 201 }, (_, i) => String.fromCodePoint(0xe0100 + i)).join(''));
  await expect(page.getByRole('table', { name: '不可視文字の種類別集計', exact: true }).locator('tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: '不可視文字の種類別集計の全件を準備', exact: true }).click();
  const kinds = page.getByRole('button', { name: '不可視文字の種類別集計の全件をコピー', exact: true });
  await expect(kinds).toBeEnabled();
  await kinds.click();
  await expect.poll(() => copiedLines(page)).toBe(202);
});

test('文字数：別の行の不完全なサロゲートをUTF-8集計で結合しない', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('dev-toolbox:input:count', String.fromCharCode(0xd83d) + '\r\n' + String.fromCharCode(0xde00)));
  await page.goto('./#/count');
  const stat = page.locator('.stat').filter({ has: page.locator('.stat-label').getByText('UTF-8', { exact: true }) });
  const group = page.getByRole('group', { name: '改行の数え方', exact: true });
  await group.getByRole('button', { name: /LF.*1/ }).click();
  await expect(stat.locator('.stat-value')).toHaveText('7');
  await group.getByRole('button', { name: /CRLF/ }).click();
  await expect(stat.locator('.stat-value')).toHaveText('8');
});

test('修正確認：CRの直後でもEnterで1行を追加する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await pasteLargeInput(page, 'テキスト', 'a\rb');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await input.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(2, 2); });
  await input.press('Enter');
  await expect(input).toHaveValue('a\n\nb');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count')?.replace(/\r\n?/g, '\n'))).toBe('a\n\nb');
});

test('修正確認：CRの直後にLFを貼り付けても改行を失わない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await pasteLargeInput(page, 'テキスト', 'a\rb');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await paste(input, '\n', [2, 2]);
  await expect(input).toHaveValue('a\n\nb');
  await expect.poll(() => input.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(3);
});

test('文字数：範囲外の上限は使わず、再読み込みでは直前の有効値を使う', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await selectCountView(page, '桁あふれ');
  const limit = page.getByLabel('上限', { exact: true });
  await limit.fill('2');
  await limit.fill('9'.repeat(400));
  await expect(page.getByRole('alert')).toContainText('上限は');
  await expect(page.getByLabel('超過行だけ表示')).toHaveCount(0);
  await page.reload();
  await selectCountView(page, '桁あふれ');
  await expect(limit).toHaveValue('2');
});

test('修正確認：UndoとRedoは混在改行を元の表記のまま復元する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  const original = 'a\r\n\rb';
  await pasteLargeInput(page, 'テキスト', original);
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  const read = () => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'));
  await input.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(1, 1); });
  await input.press('Delete');
  await expect.poll(read).toBe('a\rb');
  await input.press('Control+z');
  await expect.poll(read).toBe(original);
  await input.press('Control+Shift+z');
  await expect.poll(read).toBe('a\rb');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect.poll(read).toBe(original);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect.poll(read).toBe('a\rb');
  await input.evaluate((element) => element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true })));
  await expect.poll(read).toBe(original);
  for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
    await input.dispatchEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, ...ime });
    await expect.poll(read).toBe(original);
  }
  await page.getByRole('button', { name: '不可視文字のサンプル', exact: true }).click();
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'やり直す', exact: true })).toBeDisabled();
});

test('文字数画面：表示を切り替えても入力・改行・測定設定・ページを保持する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  const input = Array(250).fill('abc\u00a0').join('\r\n');
  await pasteLargeInput(page, 'テキスト', input);
  await expect(page.getByRole('button', { name: '文字数', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: '文字数の結果', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '不可視文字検査', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '桁あふれの結果', exact: true })).toHaveCount(0);
  await selectCountView(page, '桁あふれ');
  await page.getByLabel('上限', { exact: true }).fill('2');
  /** 再計算完了で上部の操作欄が動くため、クリック位置が変わる前に計算完了を待つ。 */
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await page.getByRole('checkbox', { name: '超過行だけ表示', exact: true }).check();
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await page.getByRole('button', { name: '次の100行', exact: true }).click();
  await expect(page.getByText('上限を超えた行のうち、101〜200行を表示しています（全 250 行）')).toBeVisible();
  await selectCountView(page, '不可視文字');
  await expect(page.getByRole('region', { name: '文字数の結果', exact: true })).toHaveCount(0);
  await expect(page.getByRole('table', { name: '不可視文字の種類別集計' })).toContainText('U+00A0');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^CRLF$/ }) }).locator('.stat-value')).toHaveText('249');
  await selectCountView(page, '桁あふれ');
  await expect(page.getByLabel('上限', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('checkbox', { name: '超過行だけ表示', exact: true })).toBeChecked();
  await expect(page.getByText('上限を超えた行のうち、101〜200行を表示しています（全 250 行）')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe(input);
  await page.reload();
  await expect(page.getByRole('button', { name: '桁あふれ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('dev-toolbox:input:count'))).toBeNull();
  await page.getByRole('button', { name: '不可視文字のサンプル', exact: true }).click();
  await expect(page.getByRole('button', { name: '不可視文字', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('回帰：混在改行のDelete・Backspace・Enterを選択位置どおりに反映する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  const read = () => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'));
  await pasteLargeInput(page, 'テキスト', 'a\r\n\rb');
  await input.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(1, 1); });
  await input.press('Delete');
  await expect.poll(read).toBe('a\rb');
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  await pasteLargeInput(page, 'テキスト', 'a\r\n\rb');
  await input.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(3, 3); });
  await input.press('Backspace');
  await expect.poll(read).toBe('a\r\nb');
  await input.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(1, 1); });
  await input.press('Enter');
  await expect.poll(read).toBe('a\n\r\nb');
});

test('不可視文字：貼り付けた改行・位置を保ち、NBSP・ゼロ幅文字・BOMを可視化する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await selectCountView(page, '不可視文字');
  const text = '\ufeffA\u00a0\r\n😀\t\u200b\nZ\r';
  await pasteLargeInput(page, 'テキスト', text);
  const kinds = page.getByRole('table', { name: '不可視文字の種類別集計' });
  await expect(kinds.getByRole('row').filter({ hasText: 'U+00A0' })).toContainText('1行目 3文字目');
  await expect(kinds.getByRole('row').filter({ hasText: 'U+200B' })).toContainText('2行目 3文字目');
  await expect(kinds.getByRole('row').filter({ hasText: 'U+FEFF' })).toContainText('1行目 1文字目');
  await expect(page.getByText('CRLF・LF・CRのうち、複数の改行コードが混在しています。', { exact: true })).toBeVisible();
  const preview = page.getByRole('region', { name: '不可視文字の可視化' });
  await expect(preview).toContainText('[BOM]A[NBSP][CRLF]');
  await expect(preview).toContainText('😀[TAB][ZWSP][LF]');
  expect(await preview.textContent()).not.toContain('\u200b');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe(text);
  /** textarea の表示は LF でも、直接編集していない範囲の CRLF・CR は失わない。 */
  const input = page.getByRole('textbox', { name: 'テキスト', exact: true });
  await input.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(2, 2); });
  await input.press('x');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe(text.slice(0, 2) + 'x' + text.slice(2));
  await pasteImageOverAll(input);
  expect(await page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe(text.slice(0, 2) + 'x' + text.slice(2));
  await expect(kinds.getByRole('row').filter({ hasText: 'U+00A0' })).toContainText('1行目 4文字目');
  await selectCountView(page, '文字数');
  await page.getByRole('group', { name: '改行の数え方' }).getByRole('button', { name: 'CRLF（2）', exact: true }).click();
  await selectCountView(page, '不可視文字');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^CRLF$/ }) }).locator('.stat-value')).toHaveText('1');
});

test('不可視文字：UTF-8ファイルのBOM・改行を保持し、不正なUTF-8はエラーにする', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await selectCountView(page, '不可視文字');
  const text = '\ufeffA\r\nB\rC\n';
  await pickFile(page, 'mixed.txt', text, 'text/plain');
  const kinds = page.getByRole('table', { name: '不可視文字の種類別集計' });
  await expect(kinds.getByRole('row').filter({ hasText: 'U+FEFF' })).toContainText('[BOM]');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe(text);
  for (const label of ['CRLF', 'LF', 'CR']) {
    await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.stat-value')).toHaveText('1');
  }
  await pickFile(page, 'invalid.txt', [0xff]);
  await expect(page.getByRole('alert')).toContainText('UTF-8のファイルか');
  expect(await page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:count'))).toBe(text);
});

test('不可視文字：古いファイルの読み込みで、新しい入力やクリアを上書きしない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await selectCountView(page, '不可視文字');
  await page.locator('input[type=file]').evaluate((input: HTMLInputElement) => {
    const slow = new File(['old\u00a0\r\n'], 'slow.txt');
    slow.arrayBuffer = () => new Promise((resolve) => {
      (window as Window & { finishCountRead?: () => void }).finishCountRead = () => resolve(new TextEncoder().encode('old\u00a0\r\n').buffer);
    });
    const choose = (file: File) => {
      const data = new DataTransfer();
      data.items.add(file);
      input.files = data.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    choose(slow);
    choose(new File(['new\u200b'], 'new.txt'));
  });
  await expect(page.getByRole('textbox', { name: 'テキスト', exact: true })).toHaveValue('new\u200b');
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  await page.evaluate(async () => {
    (window as Window & { finishCountRead?: () => void }).finishCountRead?.();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.getByRole('textbox', { name: 'テキスト', exact: true })).toHaveValue('');
  await expect(page.getByRole('table', { name: '不可視文字の種類別集計' })).toHaveCount(0);
});

test('不可視文字：大容量でも全文を集計し、検出位置とプレビューの表示を制限する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await selectCountView(page, '不可視文字');
  await pasteLargeInput(page, 'テキスト', '\u200b'.repeat(100000) + '\r\n\u00a0');
  const kinds = page.getByRole('table', { name: '不可視文字の種類別集計' });
  await expect(kinds.getByRole('row').filter({ hasText: 'U+200B' })).toContainText('100,000');
  await expect(kinds.getByRole('row').filter({ hasText: 'U+00A0' })).toContainText('2行目 1文字目');
  await expect(page.getByRole('table', { name: '不可視文字の出現位置' }).locator('tbody tr')).toHaveCount(100);
  await expect(page.getByText('検出位置は先頭 100 件を表示しています（全 100,001 件）。', { exact: true })).toBeVisible();
  await expect(page.getByText('可視化は先頭2,000文字相当までです。集計・検出位置は全文を対象にしています。', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '不可視文字の可視化' }).locator('.badge')).toHaveCount(2000);
});

test('大容量の文字数：表示外も含めて全文を計測し、100行ずつ表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await pasteLargeInput(page, 'テキスト', Array(10000).fill('abc😀').join('\n'));
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^行数$/ }) }).locator('.stat-value')).toHaveText('10,000');
  await expect(page.locator('.stat').filter({ has: page.locator('.stat-label', { hasText: /^コードポイント$/ }) }).locator('.stat-value')).toHaveText('40,000');
  await selectCountView(page, '桁あふれ');
  await expect(page.getByRole('table', { name: '行ごとの長さ', exact: true }).locator('tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: '次の100行', exact: true }).click();
  await expect(page.getByText('101〜200行を表示しています（全 10,000 行）')).toBeVisible();
});

test('文字数：全行を計測し、絞り込んだ結果も100行ずつ表示する', async ({ page }) => {
  await page.goto('./#/count');
  await selectCountView(page, '桁あふれ');
  await page.getByLabel('テキスト', { exact: true }).fill(Array.from({ length: 1500 }, () => 'abcdef').join('\n'));
  await page.getByLabel('上限').fill('3');
  await page.getByRole('checkbox', { name: '超過行だけ表示' }).check();
  await expect(page.getByRole('table', { name: '行ごとの長さ', exact: true }).locator('tbody tr')).toHaveCount(100);
  await expect(page.getByText('上限を超えた行のうち、1〜100行を表示しています（全 1,500 行）')).toBeVisible();
  await page.getByRole('button', { name: '次の100行', exact: true }).click();
  await expect(page.getByText('上限を超えた行のうち、101〜200行を表示しています（全 1,500 行）')).toBeVisible();
  /** 上限を空にすると切り替えが消えるので、絞り込みもやめてすべての行を出す */
  await page.getByLabel('上限').fill('');
  await expect(page.getByRole('table', { name: '行ごとの長さ', exact: true }).locator('tbody tr')).toHaveCount(100);
  await expect(page.getByText('1〜100行を表示しています（全 1,500 行）', { exact: true })).toBeVisible();
});

test('文字数：Shift_JIS・EUC-JP にない文字と機種依存文字を一覧にし、行の中で強調する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/count');
  await page.getByLabel('テキスト', { exact: true }).fill('𠮷野家と㈱\n丂');
  const sjis = page.locator('.notice', { hasText: 'Shift_JIS で表現できない文字があります' });
  await expect(sjis).toContainText('U+20BB7');
  await expect(sjis).toContainText('サロゲートペア');
  await expect(sjis).toContainText('2行目 1文字目');
  await expect(page.locator('.notice', { hasText: 'EUC-JP で表現できない文字があります' })).not.toContainText('U+4E02');
  await expect(page.locator('.notice', { hasText: '機種依存文字があります' })).toContainText('NEC特殊文字');
  await selectCountView(page, '桁あふれ');
  await expect(page.locator('mark.char-bad')).toHaveText(['𠮷', '丂']);
});
