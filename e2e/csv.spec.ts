/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 * - `report-tsv`・`report-json`・`report.csv.bak` では現在の変換方向と区切り文字を変えないこと（あわせて `src/tools/csv-json/fileOptions.test.ts`）。
 *
 * - [R020] CSV変換：展開量の制限と修正後の再変換、最後に選んだファイルの内容・方向・区切り文字を保つこと、古い読み込みエラーを消去後に表示しないこと、逆方向の入力上限を超える出力で入れ替えを無効にすること、タブ区切りで書いた結果の入れ替えで区切り文字を引き継ぎ元のJSONに戻ること（あわせて `src/tools/csv-json/fileOptions.test.ts`・ `src/tools/csv-json/logic.test.ts`・`src/tools/csv-json/parseCsv.test.ts`・`src/tools/csv-json/writeCsv.test.ts`・`src/tools/csv-json/roundTrip.test.ts`・`src/tools/csv-json/csvFormat.test.ts`・`e2e/calculation.spec.ts`）
 * - [R040] ファイル名の大文字・未知の拡張子・拡張子なし × 現在の変換方向と区切り文字：最後のドットに続く既知の拡張子だけを判定し、`report-tsv`・`report-json`・`report.csv.bak` では方向と区切り文字を保つ（あわせて `src/tools/csv-json/fileOptions.test.ts`）
 * - [R042] JSONのエスケープ × CSVの見出し・セル × UTF-8保存：不完全な上位・下位サロゲートを復号後に拒否する。絵文字・文字列としてのエスケープ・入れ子のJSON・出力しない見出しは保ち、ブラウザで保存したバイト列が出力のUTF-8と一致する（あわせて `src/tools/csv-json/writeCsv.test.ts`）
 * - [R054] 重複した親キーを展開前に拒否し、有効なJSONへの編集で再開する。
 */
import { expect, test } from './fixtures';
import { type Page } from '@playwright/test';
import { CROSS_BROWSER } from './tags';
import { openNavigation, settleRendering } from './app';
import { pickFile } from './files';

/** CSV変換の画面（ファイルの読み込みの競合・失敗、区切り文字、展開量の上限）の E2E。編集は csv-file-edit.spec.ts */

test('CSV変換：重複した親キーは展開前に拒否し、修正したJSONを変換できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  await page.getByRole('button', { name: 'JSON → CSV', exact: true }).click();
  const input = page.getByRole('textbox', { name: '入力（JSON）', exact: true });
  const output = page.getByRole('textbox', { name: '出力（CSV）', exact: true });
  await input.fill('[{"a":{"x":1},"a":{"y":2}}]');
  await expect(page.getByRole('alert')).toContainText('項目名「a」が重複');
  await expect(output).toHaveValue('');
  await input.fill('[{"a":{"x":1},"b":{"y":2}}]');
  await expect(output).toHaveValue('a.x,b.y\n1,2');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('CSV変換：タブ区切りで書いた結果を入れ替えると、区切り文字を引き継いで元のJSONに戻る', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  await page.getByRole('button', { name: 'JSON → CSV', exact: true }).click();
  const delimiter = page.getByRole('combobox', { name: '区切り文字', exact: true });
  await delimiter.selectOption('\t');
  await page.getByRole('textbox', { name: '入力（JSON）', exact: true }).fill('[{"a":1,"b":2}]');
  await expect(page.getByRole('textbox', { name: '出力（CSV）', exact: true })).toHaveValue('a\tb\n1\t2');
  await page.getByRole('button', { name: '⇄ 入れ替え', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '入力（CSV）', exact: true })).toHaveValue('a\tb\n1\t2');
  await expect(delimiter).toHaveValue('\t');
  await expect(page.getByRole('textbox', { name: '出力（JSON）', exact: true })).toHaveValue('[\n  {\n    "a": 1,\n    "b": 2\n  }\n]');
});

test('CSV保存：不完全なサロゲートを拒否し、修正した文字をUTF-8のまま保存する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  await page.getByRole('button', { name: 'JSON → CSV', exact: true }).click();
  await page.getByRole('combobox', { name: '改行', exact: true }).selectOption('\r\n');
  const input = page.getByRole('textbox', { name: '入力（JSON）', exact: true });
  const output = page.getByRole('textbox', { name: '出力（CSV）', exact: true });
  for (const [json, position] of [
    ['[{"value":"\\ud800"}]', '2行1列目'],
    ['[{"\\udc00":"ok"}]', '1行1列目'],
  ] as const) {
    await input.fill(json);
    await expect(page.getByRole('alert')).toContainText(position);
    await expect(page.getByRole('alert')).toContainText('UTF-8');
    await expect(output).toHaveValue('');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  }
  await input.fill('[{"value":"😀"}]');
  await expect(output).toHaveValue('value\n😀');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'BOM付き' }).uncheck();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const stream = await (await downloading).createReadStream();
  if (!stream) throw new Error('ダウンロード結果を読み取れません');
  const bytes: number[] = [];
  for await (const chunk of stream) for (const byte of chunk) bytes.push(byte);
  /** textarea は表示時に CRLF を LF にするため、保存バイトは指定した改行と独立に照合する。 */
  expect(bytes).toEqual([...new TextEncoder().encode('value\r\n😀')]);
});

test('CSV変換：展開量を制限し、修正後も変換を続けられる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  await page.getByRole('button', { name: 'JSON → CSV', exact: true }).click();
  await page.getByRole('textbox', { name: '入力（JSON）', exact: true }).fill(JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ [`k${i}`]: i }))));
  await expect(page.getByRole('alert')).toContainText('セル数');
  await expect(page.getByRole('textbox', { name: '出力（CSV）', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await page.getByRole('textbox', { name: '入力（JSON）', exact: true }).fill('[{"n":9007199254740993}]');
  await expect(page.getByRole('textbox', { name: '出力（CSV）', exact: true })).toHaveValue('n\n9007199254740993');
});

async function beginPendingCsvRead(page: Page, reject = false) {
  await page.locator('input[type=file]').evaluate((picker: HTMLInputElement, shouldReject) => {
    const file = new File(['old\tvalue\nsecret\t1'], 'old.tsv');
    file.arrayBuffer = () => new Promise((resolve, rejectRead) => {
      (window as unknown as { finishCsvRead: () => void }).finishCsvRead = () => {
        if (shouldReject) rejectRead(new Error('読込失敗'));
        else resolve(new TextEncoder().encode('old\tvalue\nsecret\t1').buffer);
      };
    });
    const data = new DataTransfer(); data.items.add(file);
    picker.files = data.files; picker.dispatchEvent(new Event('change', { bubbles: true }));
  }, reject);
}

for (const action of ['edit', 'clear', 'sample', 'swap', 'navigate', 'delimiter', 'direction', 'encoding'] as const) {
  test(`CSV読込の競合：${action}操作を古いファイルで上書きしない`, CROSS_BROWSER, async ({ page }) => {
    await page.goto('./#/csv');
    const input = page.getByRole('textbox', { name: /^入力（/ });
    await input.fill('name,value\ninitial,1');
    await beginPendingCsvRead(page);
    if (action === 'edit') await input.fill('name,value\nnew,2');
    else if (action === 'clear') await page.getByRole('button', { name: 'クリア', exact: true }).click();
    else if (action === 'sample') await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    else if (action === 'swap') await page.getByRole('button', { name: '⇄ 入れ替え', exact: true }).click();
    else if (action === 'navigate') {
      await openNavigation(page);
      await page.getByRole('link', { name: 'JSON整形', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'JSON整形', exact: true })).toBeVisible();
    } else if (action === 'delimiter') await page.getByRole('combobox', { name: '区切り文字', exact: true }).selectOption(';');
    else if (action === 'direction') await page.getByRole('group', { name: '変換の向き' }).getByRole('button', { name: 'JSON → CSV', exact: true }).click();
    else await page.getByRole('combobox', { name: 'ファイルの文字コード', exact: true }).selectOption('shift_jis');
    const stored = () => page.evaluate(() => ({ input: sessionStorage.getItem('dev-toolbox:input:csv'), direction: localStorage.getItem('dev-toolbox:pref:csv:dir'), options: localStorage.getItem('dev-toolbox:pref:csv:c2j') }));
    const expected = await stored();
    const expectedInput = action === 'navigate' ? null : await input.inputValue();
    await page.evaluate(() => (window as unknown as { finishCsvRead: () => void }).finishCsvRead());
    await settleRendering(page);
    expect(await stored()).toEqual(expected);
    if (expectedInput !== null) await expect(input).toHaveValue(expectedInput);
    else {
      await openNavigation(page);
      await page.getByRole('link', { name: 'CSV ⇔ JSON', exact: true }).click();
      await expect(input).toHaveValue('name,value\ninitial,1');
    }
  });
}

test('CSV読込の競合：古い読込エラーはクリア後に表示しない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await beginPendingCsvRead(page, true);
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  await page.evaluate(() => (window as unknown as { finishCsvRead: () => void }).finishCsvRead());
  await settleRendering(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('CSV読込：読込に失敗しても現在の入力を残しエラーを通知する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  const input = page.getByRole('textbox', { name: '入力（CSV）', exact: true });
  await input.fill('name\ncurrent');
  await beginPendingCsvRead(page, true);
  await page.evaluate(() => (window as unknown as { finishCsvRead: () => void }).finishCsvRead());
  await expect(page.getByRole('alert')).toContainText('ファイルを読み込めません');
  await expect(input).toHaveValue('name\ncurrent');
});

test('CSV：古いファイルが後から読み終わっても、最後に選んだファイルの内容・方向・区切り文字を保つ', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  await page.locator('input[type=file]').evaluate((input: HTMLInputElement) => {
    const choose = (file: File) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const slow = new File(['[{"old":true}]'], 'slow.json');
    /** テストから完了を制御し、新しいファイルの反映後に古いファイルを読み終える */
    slow.arrayBuffer = () => new Promise((resolve) => {
      (window as unknown as { finishCsvRead: () => void }).finishCsvRead = () =>
        resolve(new TextEncoder().encode('[{"old":true}]').buffer);
    });
    choose(slow);
    choose(new File(['name\tvalue\nnew\t2'], 'fast.tsv'));
  });
  const input = page.getByRole('textbox', { name: '入力（CSV）', exact: true });
  await expect(input).toHaveValue('name\tvalue\nnew\t2');
  await page.evaluate(async () => {
    (window as unknown as { finishCsvRead: () => void }).finishCsvRead();
    /** 読み込み後の Promise と React の更新が処理されるまで待つ */
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(input).toHaveValue('name\tvalue\nnew\t2');
  await expect(page.getByRole('group', { name: '変換の向き' }).getByRole('button', { name: 'CSV → JSON' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: /区切り文字/ })).toHaveValue('\t');
  await expect(page.getByRole('textbox', { name: '出力（JSON）', exact: true })).toHaveValue('[\n  {\n    "name": "new",\n    "value": 2\n  }\n]');
});

test('CSV：未知の拡張子や拡張子のないファイルは方向と区切り文字を変えない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/csv');
  const direction = page.getByRole('group', { name: '変換の向き' });
  const delimiter = page.getByRole('combobox', { name: '区切り文字', exact: true });
  for (const name of ['report-tsv', 'report-json', 'report.csv.bak']) {
    await pickFile(page, name, 'id,name\n1,x');
    await expect(page.getByRole('textbox', { name: '入力（CSV）', exact: true })).toHaveValue('id,name\n1,x');
    await expect(direction.getByRole('button', { name: 'CSV → JSON', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(delimiter).toHaveValue(',');
    await expect(page.getByRole('textbox', { name: '出力（JSON）', exact: true })).toHaveValue('[\n  {\n    "id": 1,\n    "name": "x"\n  }\n]');
  }
});

test('CSV：TSV の後に CSV ファイルを選ぶと、区切り文字をカンマに戻す', async ({ page }) => {
  await page.goto('./#/csv');
  const choose = (name: string, text: string) => pickFile(page, name, text);
  const output = page.getByRole('textbox', { name: '出力（JSON）', exact: true });
  const delimiter = page.getByRole('combobox', { name: /区切り文字/ });

  await choose('a.tsv', 'id\tname\n1\tx');
  await expect(delimiter).toHaveValue('\t');
  await expect(output).toHaveValue('[\n  {\n    "id": 1,\n    "name": "x"\n  }\n]');
  await choose('b.csv', 'id,name\n2,y');
  await expect(delimiter).toHaveValue(',');
  await expect(output).toHaveValue('[\n  {\n    "id": 2,\n    "name": "y"\n  }\n]');
  /** .txt は区切り文字を推測できないため、今の設定のまま読む */
  await delimiter.selectOption('\t');
  await choose('c.txt', 'id\tname\n3\tz');
  await expect(delimiter).toHaveValue('\t');
  await expect(output).toHaveValue('[\n  {\n    "id": 3,\n    "name": "z"\n  }\n]');
});
