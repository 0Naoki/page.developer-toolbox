/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R023] ハッシュ：再計算中や HMAC の鍵・入力元の切り替えで古い値・一致表示を出さないこと、上限を超えるファイルで「計算中」の表示を残さないこと、ファイルの HMAC で鍵を続けて打っても打つたびにファイルを読み直さないこと
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { settleRendering } from './app';
import { pickFile } from './files';

/** ハッシュ生成の E2E（再計算中の古い結果の非表示、HMAC、ファイルの上限、キーボード操作） */

test('回帰：ハッシュの再計算中は古い値・一致表示・コピーを表示しない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/hash');
  const input = page.getByRole('textbox', { name: 'テキスト（UTF-8）', exact: true });
  const oldHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  await input.fill('abc');
  await expect(page.getByText(oldHash, { exact: true })).toBeVisible();
  await page.getByLabel('照合（期待するハッシュ値を貼り付け）').fill(oldHash);
  await expect(page.locator('.notice.good')).toBeVisible();
  await page.evaluate(() => {
    const native = crypto.subtle.digest.bind(crypto.subtle);
    let hold = true;
    crypto.subtle.digest = (algorithm, data) => {
      if (hold) {
        hold = false;
        return new Promise((resolve, reject) => {
          (window as Window & { finishHashRead?: () => void }).finishHashRead = () => {
            crypto.subtle.digest = native;
            native(algorithm, data).then(resolve, reject);
          };
        });
      }
      return native(algorithm, data);
    };
  });
  await input.fill('def');
  await page.waitForFunction(() => Boolean((window as Window & { finishHashRead?: () => void }).finishHashRead));
  await expect(page.locator('.hash-value')).toHaveCount(0);
  await expect(page.locator('.notice.good')).toHaveCount(0);
  await expect(page.locator('.hash-table button')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('計算中');
  await page.evaluate(() => (window as Window & { finishHashRead?: () => void }).finishHashRead?.());
  await expect(page.locator('.hash-value')).toHaveCount(5);
  await expect(page.getByText(oldHash, { exact: true })).toHaveCount(0);
  await expect(page.locator('.notice.bad')).toBeVisible();
});

test('回帰：HMACの鍵と入力元の切り替えでも、古い計算結果を表示しない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/hash');
  await page.getByRole('textbox', { name: 'テキスト（UTF-8）', exact: true }).fill('abc');
  await page.getByRole('checkbox', { name: 'HMAC', exact: true }).check();
  const key = page.getByLabel('秘密鍵（UTF-8として扱います。保存されません）');
  await key.fill('old-secret-key-for-regression');
  await expect(page.locator('.hash-value')).toHaveCount(4);
  const previous = await page.locator('.hash-value').allTextContents();
  await page.evaluate(() => {
    const native = crypto.subtle.sign.bind(crypto.subtle);
    let hold = true;
    crypto.subtle.sign = (algorithm, key, data) => {
      if (hold) {
        hold = false;
        return new Promise((resolve, reject) => {
          (window as Window & { finishHashSign?: () => void }).finishHashSign = () => {
            crypto.subtle.sign = native;
            native(algorithm, key, data).then(resolve, reject);
          };
        });
      }
      return native(algorithm, key, data);
    };
  });
  await key.fill('new-secret-key-for-regression');
  await page.waitForFunction(() => Boolean((window as Window & { finishHashSign?: () => void }).finishHashSign));
  await expect(page.locator('.hash-value')).toHaveCount(0);
  await page.getByRole('group', { name: '入力', exact: true }).getByRole('button', { name: 'ファイル', exact: true }).click();
  await page.evaluate(() => (window as Window & { finishHashSign?: () => void }).finishHashSign?.());
  await settleRendering(page);
  await expect(page.locator('.hash-value')).toHaveCount(0);
  await page.getByRole('group', { name: '入力', exact: true }).getByRole('button', { name: 'テキスト', exact: true }).click();
  await expect(page.locator('.hash-value')).toHaveCount(4);
  expect(await page.locator('.hash-value').allTextContents()).not.toEqual(previous);
  const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
  expect(stored).not.toContain('secret-key-for-regression');
});

test('ハッシュのファイル欄は、キーボードで選ぶと枠が表示される', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/hash');
  await page.getByRole('button', { name: 'ファイル' }).click();
  const dropzone = page.locator('.dropzone');
  await expect(dropzone).toHaveCSS('outline-style', 'none');
  /** ボタンから Tab で移動し、見えないファイル入力にキーボードでフォーカスする */
  await page.getByRole('checkbox', { name: 'HMAC' }).focus();
  await page.keyboard.press('Tab');
  await expect(dropzone.locator('input[type="file"]')).toBeFocused();
  await expect(dropzone).toHaveCSS('outline-style', 'solid');
});

test('ハッシュ：計算中に上限を超えるファイルを選んでも、「計算中」の表示が残らない', async ({ page }) => {
  await page.goto('./#/hash');
  await page.getByRole('button', { name: 'ファイル' }).click();
  /** ファイルはブラウザの中で作って選ぶ（大きなファイルを手元に用意しなくて済むように） */
  const pick = (size: number, name: string) => pickFile(page, name, { zeros: size });
  await pick(64 * 1024 * 1024, 'calculating.bin');
  await expect(page.getByText(/計算中…/)).toBeVisible();
  await pick(257 * 1024 * 1024, 'too-large.bin');
  await expect(page.getByText('ファイルが大きすぎます（上限 256 MiB）')).toBeVisible();
  await expect(page.getByText(/計算中…/)).toHaveCount(0);
  await expect(page.locator('.hash-table')).toHaveAttribute('aria-busy', 'false');
});

test('回帰：ファイルの HMAC で鍵を続けて打っても、打つたびにファイルを読み直さない', CROSS_BROWSER, async ({ page }) => {
  await page.clock.install();
  await page.goto('./#/hash');
  await page.getByRole('group', { name: '入力', exact: true }).getByRole('button', { name: 'ファイル', exact: true }).click();
  await page.getByRole('checkbox', { name: 'HMAC', exact: true }).check();
  await pickFile(page, 'data.txt', 'abc');
  /** ファイルの読み込み（File.arrayBuffer）の回数を数える */
  await page.evaluate(() => {
    const w = window as Window & { fileReads?: number };
    const native = Blob.prototype.arrayBuffer;
    w.fileReads = 0;
    Blob.prototype.arrayBuffer = function (this: Blob) {
      w.fileReads = (w.fileReads ?? 0) + 1;
      return native.call(this);
    };
  });
  /** install() だけでは時計は進み続ける。鍵を打つ途中・打ち終わってから確かめるまでに150msの待ちが終わらないよう、ここで止める */
  await page.clock.pauseAt(Date.now() + 60_000);
  await page.getByLabel('秘密鍵（UTF-8として扱います。保存されません）').pressSequentially('secret');
  expect(await page.evaluate(() => (window as Window & { fileReads?: number }).fileReads)).toBe(0);
  await page.clock.runFor(200);
  /** HMAC-SHA256("secret", "abc") */
  await expect(page.locator('.hash-value').filter({ hasText: '9946dad4e00e913fc8be8e5d3f7e110a4a9e832f83fb09c345285d78638d8a0e' })).toHaveCount(1);
  expect(await page.evaluate(() => (window as Window & { fileReads?: number }).fileReads)).toBe(1);
  const key = page.getByLabel('秘密鍵（UTF-8として扱います。保存されません）');
  for (const value of ['other', 'another']) {
    await key.fill(value);
    await page.clock.runFor(200);
    await expect(page.locator('.hash-value')).toHaveCount(4);
    expect(await page.evaluate(() => (window as Window & { fileReads?: number }).fileReads)).toBe(1);
  }
  await pickFile(page, 'changed.txt', 'def');
  await page.clock.runFor(200);
  await expect(page.locator('.hash-value')).toHaveCount(4);
  expect(await page.evaluate(() => (window as Window & { fileReads?: number }).fileReads)).toBe(2);
});
