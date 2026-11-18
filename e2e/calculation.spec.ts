/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R015] 大容量計算：全文の保存、値の表記、Workerの中断・再計算、古い応答の破棄、差分の計算中に旧結果を表示しつつコピーを無効にすること、大きな差分の分離、JSON整形の大量の重複キーの警告を、Worker から画面へ渡す前に先頭5件と残りの件数にすること
 * - [R016] テキスト差分の改行：CRLF・LF・混在のテキストで、元の改行のまま unified 形式を出力すること。短いCRLF入力を貼り付けてコピーし、変更行と共通行のCRLFが保持されること（あわせて `src/tools/text-diff/logic.test.ts`）
 */
import { expect, test } from './fixtures';
import { type Page } from '@playwright/test';
import { CROSS_BROWSER } from './tags';
import { pasteLargeInput } from './paste';
import { downloadedText, pickFile } from './files';
import { openPalette } from './app';
import { captureClipboard, copiedText, copiedLength } from './clipboard';

test('テキスト差分：短い貼り付けのCRLFをunifiedコピーに保持する', CROSS_BROWSER, async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/diff');
  await pasteLargeInput(page, '変更前', 'a\r\nb\r\nc\r\n');
  await pasteLargeInput(page, '変更後', 'a\r\nB\r\nc\r\n');
  await page.getByRole('button', { name: 'unified形式でコピー' }).click();
  await expect.poll(() => copiedText(page)).toBe('--- before\n+++ after\n@@ -1,3 +1,3 @@\n a\r\n-b\r\n+B\r\n c\r\n');
});

test('CSV変換：出力プレビューを制限しても保存には全文を使う', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  await page.getByRole('button', { name: 'JSON → CSV', exact: true }).click();
  await page.getByRole('textbox', { name: '入力（JSON）', exact: true }).fill(JSON.stringify([{ text: 'x'.repeat(60_000), tail: 'LAST' }]));
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  expect((await page.getByRole('textbox', { name: '出力（CSV）', exact: true }).inputValue()).length).toBeLessThanOrEqual(50_000);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const saved = await downloadedText(await downloading);
  expect(saved.length).toBeGreaterThan(60_000);
  expect(saved).toContain('LAST');
});

test('CSV変換：逆方向の入力上限を超える出力は入れ替えない', async ({ page }) => {
  await page.goto('./#/csv');
  await pasteLargeInput(page, '入力（CSV）', 'a\n"' + '\t'.repeat(4_000_001) + '"');
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await expect(page.getByRole('button', { name: '⇄ 入れ替え', exact: true })).toBeDisabled();
  await expect(page.getByText('変換結果が逆方向の入力上限を超えています')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
});

test('CSV変換：Workerを中断でき、次の入力で古い結果を表示しない', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown): void {
        if ((message as { tool?: string; input?: string }).tool === 'csv' && (message as { input: string }).input.includes('__HOLD__')) {
          (window as Window & { csvHeld?: boolean }).csvHeld = true;
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto('./#/csv');
  const input = page.getByRole('textbox', { name: '入力（CSV）', exact: true });
  const output = page.getByRole('textbox', { name: '出力（JSON）', exact: true });
  await input.fill('n\n1');
  await expect(output).toHaveValue('[\n  {\n    "n": 1\n  }\n]');
  await input.fill('n\n__HOLD__');
  await expect.poll(() => page.evaluate(() => (window as Window & { csvHeld?: boolean }).csvHeld)).toBe(true);
  await expect(page.getByRole('button', { name: '⇄ 入れ替え', exact: true })).toBeDisabled();
  await expect(output).toHaveValue('');
  await page.getByRole('button', { name: '中断', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('計算を中断しました');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await input.fill('n\n2');
  await expect(output).toHaveValue('[\n  {\n    "n": 2\n  }\n]');
});

test('大容量JSON：表示だけを制限し、全文の数値表記・編集・ファイル保存を保つ', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/json');
  const input = '{"id":9007199254740993,"amount":100.00,"text":"' + 'x'.repeat(60000) + '","tail":"LAST"}';
  await pasteLargeInput(page, '入力', input);
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  const source = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '出力', exact: true });
  expect((await source.inputValue()).length).toBeLessThanOrEqual(50000);
  expect((await output.inputValue()).length).toBeLessThanOrEqual(50000);
  await expect(source).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await expect(source).toHaveValue(input);
  await page.getByRole('button', { name: 'プレビューに戻す', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '全文を保存', exact: true }).click();
  const download = await downloading;
  const saved = await downloadedText(download);
  expect(saved).toContain('9007199254740993');
  expect(saved).toContain('100.00');
  expect(saved).toContain('"tail": "LAST"');
  expect(saved.length).toBeGreaterThan(60000);
  expect(JSON.parse(saved).text).toHaveLength(60000);
});

test('大容量計算：計算中も操作でき、中断後の古い結果を表示しない', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown): void {
        if ((message as { input?: string }).input?.includes('__SLOW__')) {
          (window as Window & { calculationHeld?: boolean }).calculationHeld = true;
          /**
           * 中断した後に、終了した Worker の結果が遅れて届く場合を、テストの合図（deliverLate）で再現する。
           * 時間で届けると、負荷でクリックが遅れたときに中断より先に届き、計算が終わってしまう
           */
          (window as Window & { deliverLate?: () => void }).deliverLate = () =>
            this.dispatchEvent(new MessageEvent('message', { data: { ok: true, result: { ok: true, output: 'OLD_RESULT', warnings: [] } } }));
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto('./#/json');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('{"__SLOW__":true}');
  await page.waitForFunction(() => (window as Window & { calculationHeld?: boolean }).calculationHeld);
  await openPalette(page);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '中断', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('計算を中断しました');
  await expect(page.getByRole('button', { name: '全文を保存', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('{"fresh":true}');
  await expect(page.getByRole('textbox', { name: '出力', exact: true })).toHaveValue('{\n  "fresh": true\n}');
  /** 終了した Worker の結果が遅れて届いても、現在の出力を上書きさせない */
  await page.evaluate(async () => {
    (window as Window & { deliverLate?: () => void }).deliverLate?.();
    /** 上書きされるなら画面に反映されるまで待ってから確かめる */
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.getByRole('textbox', { name: '出力', exact: true })).toHaveValue('{\n  "fresh": true\n}');
});

test('大容量計算：10秒で中断し、同じ入力を再計算できる', CROSS_BROWSER, async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let hold = true;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown): void {
        if (hold && (message as { input?: string }).input?.includes('__TIMEOUT__')) {
          hold = false;
          (window as Window & { calculationHeld?: boolean }).calculationHeld = true;
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto('./#/json');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('{"__TIMEOUT__":true}');
  await page.waitForFunction(() => (window as Window & { calculationHeld?: boolean }).calculationHeld);
  await page.clock.fastForward(10000);
  await expect(page.getByRole('alert')).toContainText('計算を10秒で打ち切りました');
  await page.getByRole('button', { name: '再計算', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '出力', exact: true })).toHaveValue('{\n  "__TIMEOUT__": true\n}');
});

/** CSV ⇔ JSON のファイル入力に、ページの中で作ったファイルを渡す（大きなファイルをテストの外に作らないため） */
async function openGeneratedCsv(page: Page, bytes: number, line: string) {
  await pickFile(page, 'big.csv', { repeat: line, bytes }, 'text/csv');
}

test('大容量CSV：上限を超えるファイルは読み込まず、今の入力を残す', async ({ page }) => {
  await page.goto('./#/csv');
  const input = page.getByRole('textbox', { name: '入力（CSV）', exact: true });
  await input.fill('name\noriginal');
  /** 計算の上限（800万文字）× 3バイトを超えるファイル */
  await openGeneratedCsv(page, 24_000_001, 'a,b\n');
  await expect(page.getByRole('alert')).toContainText('ファイルが大きすぎます（上限 24,000,000 バイト）。分割して読み込んでください。');
  await expect(input).toHaveValue('name\noriginal');
});

test('大容量CSV：バイト数は上限内でも、文字数が計算の上限を超えるファイルは読み込まない', async ({ page }) => {
  await page.goto('./#/csv');
  const input = page.getByRole('textbox', { name: '入力（CSV）', exact: true });
  await input.fill('name\noriginal');
  /** 1バイトの文字だけの 900万バイト（900万文字）のファイル */
  await openGeneratedCsv(page, 9_000_000, 'a,b\n');
  await expect(page.getByRole('alert')).toContainText('入力が大きすぎます');
  await expect(input).toHaveValue('name\noriginal');
});

test('大容量CSV：上限内の大きなファイルは、入力欄に先頭だけを表示する', async ({ page }) => {
  await page.goto('./#/csv');
  await openGeneratedCsv(page, 2_000_000, 'id,name\n1,abcdefghij\n');
  await expect(page.getByText(/大きな入力のため、通常は先頭/)).toBeVisible();
  const shown = await page.getByRole('textbox', { name: '入力（CSV）', exact: true }).inputValue();
  expect(shown.length).toBeLessThan(100_000);
  await expect(page.getByRole('textbox', { name: '出力（JSON）', exact: true })).toHaveValue(/"name": "abcdefghij"/);
});

test('テキスト差分：大きな入力もWorkerで計算し、変わらない行を対応づける', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/diff');
  const lines = (side: string) => Array.from({ length: 30_000 }, (_, i) => (i % 3 ? `same ${i}` : `${side} ${i}`)).join('\n');
  await pasteLargeInput(page, '変更前', lines('before'));
  await pasteLargeInput(page, '変更後', lines('after'));
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await expect(page.getByText('+10000 行', { exact: true })).toBeVisible();
  await expect(page.getByText('−10000 行', { exact: true })).toBeVisible();
  await expect(page.getByText('差分が大きいため', { exact: false })).toHaveCount(0);
});

test('テキスト差分：両方の表示で長い行を省略し、unifiedコピーは変更箇所を保持する', CROSS_BROWSER, async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/diff');
  const common = 'A'.repeat(55_000);
  const changed = 'B'.repeat(55_000);
  await pasteLargeInput(page, '変更前', `${common}\n${changed}before`);
  await pasteLargeInput(page, '変更後', `${common}\n${changed}after`);
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await expect(page.getByText('（以降省略）', { exact: true })).toHaveCount(4);
  await page.getByRole('button', { name: '1列にまとめる', exact: true }).click();
  await expect(page.getByText('（以降省略）', { exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'unified形式でコピー', exact: true }).click();
  await expect.poll(() => copiedLength(page)).not.toBeNull();
  const patch = await copiedText(page);
  expect(patch).toContain(`-${changed}before`);
  expect(patch).toContain(`+${changed}after`);
});

test('テキスト差分：計算中は旧結果を表示してコピーを無効にし、中断・失敗で消す', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown): void {
        const request = message as { tool?: string; input?: string };
        if (request.tool === 'diff' && request.input === '__FAIL__') {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
            data: { ok: false, error: 'テスト用の計算失敗' },
          })));
          return;
        }
        if (request.tool === 'diff' && request.input === '__HOLD__') {
          (window as Window & { diffHeld?: boolean }).diffHeld = true;
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto('./#/diff');
  const before = page.getByRole('textbox', { name: '変更前', exact: true });
  await before.fill('old');
  await page.getByRole('textbox', { name: '変更後', exact: true }).fill('new');
  await expect(page.getByText('+1 行', { exact: true })).toBeVisible();
  const copy = page.getByRole('button', { name: 'unified形式でコピー', exact: true });
  await expect(copy).toBeEnabled();
  await before.fill('__HOLD__');
  await expect.poll(() => page.evaluate(() => (window as Window & { diffHeld?: boolean }).diffHeld)).toBe(true);
  const previousDiff = page.locator('.diff-table');
  await expect(previousDiff).toContainText('old');
  await expect(previousDiff).toContainText('new');
  await expect(copy).toBeDisabled();
  await page.getByRole('button', { name: '中断', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('計算を中断しました');
  await expect(page.getByText('+1 行', { exact: true })).toHaveCount(0);
  await expect(copy).toHaveCount(0);
  await expect(previousDiff).toHaveCount(0);
  /** 中断で消した結果は、次の計算を待つ間にも出し直さない */
  await page.evaluate(() => { (window as Window & { diffHeld?: boolean }).diffHeld = false; });
  await page.getByRole('button', { name: '再計算', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { diffHeld?: boolean }).diffHeld)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('計算中…');
  await expect(previousDiff).toHaveCount(0);
  await expect(copy).toHaveCount(0);
  await before.fill('old2');
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await expect(copy).toBeEnabled();
  await before.fill('__FAIL__');
  await expect(page.getByRole('alert')).toHaveText('テスト用の計算失敗');
  await expect(page.getByText('+1 行', { exact: true })).toHaveCount(0);
  await expect(copy).toHaveCount(0);
  await expect(previousDiff).toHaveCount(0);
  /** 失敗で消した結果も、次の計算を待つ間に出し直さない */
  await page.evaluate(() => { (window as Window & { diffHeld?: boolean }).diffHeld = false; });
  await before.fill('__HOLD__');
  await expect.poll(() => page.evaluate(() => (window as Window & { diffHeld?: boolean }).diffHeld)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('計算中…');
  await expect(previousDiff).toHaveCount(0);
  await expect(copy).toHaveCount(0);
});

test('JSON整形：大量の重複キーの警告は、先頭5件と残りの件数だけを表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/json');
  /** 同じキーが10万個あると警告が99,999件になる。全件を Worker から画面へ渡して描画すると画面が止まる */
  await pasteLargeInput(page, '入力', `{${Array(100_000).fill('"a":1').join(',')}}`);
  await expect(page.getByRole('status')).toHaveText('計算が完了しました');
  await expect(page.locator('.notice.warn')).toHaveCount(6);
  await expect(page.locator('.notice.warn').last()).toHaveText('ほか 99,994 件の警告があります');
});
