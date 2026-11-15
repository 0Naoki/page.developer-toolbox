/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - Base64：ファイルの読み込み順序と読み込み中の旧結果の非表示、16進ダンプの出力で入れ替えを無効にすること、文字コードの切り替え、data: URI の長い MIME タイプをバッジで抜粋にすること。
 *   入力元と形式に応じた設定の適用、文字コード・BOM・ダンプの上限・入れ替え可否（あわせて `src/tools/base64/conversion.test.ts`・`src/tools/base64/presentation.test.ts`）
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { pickFile } from './files';
import { captureClipboard, copiedLines } from './clipboard';
import { pasteLargeInput } from './paste';

/** Base64・URLエンコードの画面（ファイルの読み込み順序、Worker での変換、16進ダンプ）の E2E */

test('Base64：空白だけの入力も各形式でエンコードし、空文字に戻すと出力を消す', async ({ page }) => {
  await page.goto('./#/base64');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '出力', exact: true });
  const format = page.getByRole('group', { name: '形式' });
  for (const [name, expected] of [['Base64', 'IA=='], ['Base64URL', 'IA'], ['URLエンコード', '%20']] as const) {
    await format.getByRole('button', { name, exact: true }).click();
    await input.fill(' ');
    await expect(output).toHaveValue(expected);
    await input.fill('');
    await expect(output).toHaveValue('');
  }
  await input.fill('\t\n');
  await expect(output).toHaveValue('%09%0A');
  await format.getByRole('button', { name: 'Base64', exact: true }).click();
  await expect(output).toHaveValue('CQo=');
});

test('Base64：長いテキストは Worker で変換し、出力の表示は先頭だけにして、入れ替えでは全文を使う', async ({ page }) => {
  await page.clock.install();
  await page.goto('./#/base64');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '出力', exact: true });
  const swap = page.getByRole('button', { name: '⇄ 入れ替え' });
  /** Worker の計算中は「入れ替え」を無効にする（出力がないまま方向だけが変わり、元の入力を逆向きに変換しないように） */
  await input.fill('a'.repeat(300_000));
  await expect(swap).toBeDisabled();
  await page.clock.runFor(200);
  await expect(page.getByText('画面は先頭', { exact: false })).toBeVisible();
  await expect(swap).toBeEnabled();
  await expect(output).toHaveValue('YWFh'.repeat(12_500));
  /** 長い入力も、入力欄の表示は先頭だけにする（全文の描画で画面が止まらないように） */
  await expect(input).toHaveValue('a'.repeat(50_000));
  await swap.click();
  await page.clock.runFor(200);
  await expect(input).toHaveValue('YWFh'.repeat(12_500));
  await expect(output).toHaveValue('a'.repeat(50_000));
  /** 短い入力は、これまでどおりその場で変換する */
  await page.getByRole('button', { name: '全文を編集' }).click();
  await input.fill('YWFh');
  await expect(output).toHaveValue('aaa');
  await expect(page.getByText('画面は先頭', { exact: false })).toHaveCount(0);
});

test('Base64：画像の data: URI をデコードし、16進ダンプの表示とファイルへの保存ができる', async ({ page }) => {
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '方向' }).getByRole('button', { name: 'デコード' }).click();
  /** 1×1 ピクセルの PNG */
  await page
    .getByLabel('入力', { exact: true })
    .fill('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  await expect(page.getByText('PNG 画像', { exact: true })).toBeVisible();
  await expect(page.getByText('UTF-8 のテキストとして読めないため、16進ダンプで表示しています')).toBeVisible();
  await expect(page.getByRole('region', { name: '16進ダンプ' })).toContainText('00000000  89 50 4e 47 0d 0a 1a 0a');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ファイルに保存' }).click();
  expect((await download).suggestedFilename()).toBe('decoded.png');
});

test('Base64：data: URI の長い MIME タイプは、バッジに抜粋だけを表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '方向' }).getByRole('button', { name: 'デコード' }).click();
  const mime = 'x'.repeat(200_000);
  await pasteLargeInput(page, '入力', `data:${mime};base64,QQ==`);
  /** デコードの結果は変わらず、MIME タイプのバッジは256単位の抜粋になる */
  await expect(page.getByLabel('出力', { exact: true })).toHaveValue('A');
  await expect(page.locator('.badge').filter({ hasText: 'xxx' })).toHaveText(`${'x'.repeat(255)}…`);
});

test('Base64：16進ダンプを入れ替えで元の入力に戻さない', async ({ page }) => {
  await page.goto('./#/base64');
  await page.getByRole('button', { name: 'デコード', exact: true }).click();
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('AA==');
  await expect(page.getByRole('region', { name: '16進ダンプ' })).toBeVisible();
  await expect(page.getByRole('button', { name: '⇄ 入れ替え' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ファイルに保存' })).toBeEnabled();
});

test('Base64：16進ダンプのコピーは表示中の範囲で、ボタンの名前で区別する', async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '方向' }).getByRole('button', { name: 'デコード' }).click();
  /** 0xFF が 20,001 バイト（UTF-8 として読めないので16進ダンプになる） */
  await page.getByLabel('入力', { exact: true }).fill('////'.repeat(6667));
  await expect(page.getByText('先頭 16.0 KiB だけ表示しています（コピーも表示中の範囲です）', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'コピー', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '表示中のダンプをコピー', exact: true }).click();
  /** 16 KiB ÷ 16 バイト = 1,024 行 */
  await expect.poll(() => copiedLines(page)).toBe(1024);
});

test('Base64：Shift_JIS のテキストは、文字コードを切り替えると読める', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '方向' }).getByRole('button', { name: 'デコード' }).click();
  /** Shift_JIS の「あい」（82 A0 82 A2） */
  await page.getByLabel('入力', { exact: true }).fill('gqCCog==');
  await expect(page.getByRole('region', { name: '16進ダンプ' })).toBeVisible();
  await page.getByRole('group', { name: '文字コード' }).getByRole('button', { name: 'Shift_JIS' }).click();
  await expect(page.getByLabel('出力', { exact: true })).toHaveValue('あい');
});

test('Base64：ファイルをエンコードし、data: URI の形にもできる（ファイルの中身は保存しない）', async ({ page }) => {
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '入力' }).getByRole('button', { name: 'ファイル' }).click();
  /** テキストでないバイト（00 01 02 FF）のファイルを選ぶ */
  await pickFile(page, 'sample.bin', [0, 1, 2, 255], 'application/octet-stream');
  await expect(page.getByText('sample.bin')).toBeVisible();
  await expect(page.getByLabel('出力', { exact: true })).toHaveValue('AAEC/w==');
  await page.getByLabel('data: URI の形にする').check();
  await expect(page.getByLabel('出力', { exact: true })).toHaveValue('data:application/octet-stream;base64,AAEC/w==');
  const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
  expect(stored).not.toContain('AAEC/w==');
});

test('Base64：読み込みに時間のかかるファイルの直後に別のファイルを選ぶと、後から選んだほうを表示する', async ({ page }) => {
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '入力' }).getByRole('button', { name: 'ファイル' }).click();
  await page.locator('input[type=file]').evaluate(async (input: HTMLInputElement) => {
    const choose = (file: File) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    /** 完了順序を明示的に制御し、遅い読み込みの上書きを実時間の待機なしで再現する。 */
    const slow = new File([new Uint8Array([1])], 'slow.bin');
    const read = slow.arrayBuffer.bind(slow);
    let finishSlow!: () => void;
    const slowData = new Promise<ArrayBuffer>((resolve) => { finishSlow = () => { void read().then(resolve); }; });
    slow.arrayBuffer = () => slowData;
    const fast = new File([new Uint8Array([2])], 'fast.bin');
    const fastData = fast.arrayBuffer();
    fast.arrayBuffer = () => fastData;
    choose(slow);
    choose(fast);
    await fastData;
    finishSlow();
    await slowData;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.getByText('fast.bin')).toBeVisible();
  await expect(page.getByLabel('出力', { exact: true })).toHaveValue('Ag==');
});

test('Base64：次のファイルを読み込んでいる間は前の結果をコピーできない', async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== 'B.txt') return read.call(this);
      return new Promise((resolve) => {
        document.addEventListener('finish-read', () => { void read.call(this).then(resolve); }, { once: true });
      });
    };
  });
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '入力' }).getByRole('button', { name: 'ファイル' }).click();
  const output = page.getByLabel('出力', { exact: true });
  const choose = (letter: string) => pickFile(page, `${letter}.txt`, letter, 'text/plain');
  await choose('A');
  await expect(output).toHaveValue('QQ==');
  await choose('B');
  await expect(page.getByRole('status').filter({ hasText: '読み込み中' })).toBeVisible();
  await expect(page.getByText('A.txt', { exact: true })).toHaveCount(0);
  await expect(output).toHaveValue('');
  await expect(page.getByRole('button', { name: 'コピー', exact: true })).toBeDisabled();
  await page.evaluate(() => document.dispatchEvent(new Event('finish-read')));
  await expect(output).toHaveValue('Qg==');
});
