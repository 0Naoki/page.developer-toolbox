/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R028] UNIX時間の入力単位：`1500` の自動判定と、ミリ秒を明示したときの表示を切り替えられること。パネルの移動と再読み込みで単位が「自動」に戻らず、同じ時刻のままであること。
 *   12桁のミリ秒（`631152000000`）など、桁数だけでは単位を決めきれない値は、読んだ単位を示し、もう1つの単位で読み直せること（あわせて `src/tools/unix-time/logic.test.ts`）
 * - [R029] 日時の拡張年と往復：符号付き6桁の年のISO出力を読み戻せること。Dateの両端・うるう年・不正な年の表記を検証すること。Dateの両端・10000年・紀元前で、オフセット付きの表示が NaN にならず、
 *   日時入力で同じ時刻に読み戻せること。1秒未満の端数がある時刻は、入力の単位に関係なく各タイムゾーンの表示に端数を残し、貼り戻しても同じ時刻になること（あわせて `src/lib/time/dateTimeInput.test.ts`）
 * - [R030] UNIX時間の期間計算：大きな値の加減算で差の1ミリ秒を丸めないこと。UTC・正の時差・負の時差で、暦日を足し引きして Date の上限・下限に到達できること、年・月の加算でも上限に到達できること。
 *   紀元前・西暦0年・世紀のうるう年と、Date の両端の外側の暦日を検証すること。実際の時刻が範囲外になる計算と長すぎる期間を断り、エラー後に再計算できること（あわせて `src/tools/unix-time/logic.test.ts`・`src/lib/time/civilTime.test.ts`）
 * - [R047] 日時の上限・下限 × UTC・正負の時差 × 暦日と経過時間の相殺：最終結果が範囲内なら返し、1ミリ秒でも外なら拒否する。安全な整数を超える中間ミリ秒でも端数を丸めない（あわせて `src/tools/unix-time/logic.test.ts`）
 * - [R052] 巨大なエポック × 範囲外・長い先頭の0・長い小数部 × 単位の指定：巨大な BigInt を作らず範囲外を拒否し、有効値の精度を保つ。エラーから復帰し、時計更新でも固定した日時を保つ（あわせて `src/tools/unix-time/logic.test.ts`）
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';

test('UNIX時間：巨大な範囲外入力から復帰でき、時計更新でも固定した日時を保つ', CROSS_BROWSER, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:00.000Z'));
  await page.goto('./#/time');
  const input = page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）', { exact: true });
  await input.evaluate((element: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '9'.repeat(1000000));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const pane = page.locator('.pane').first();
  await expect(pane.locator('.error-text')).toHaveText('日時に変換できない値です');
  await input.fill('1767225590');
  const iso = pane.getByRole('row', { name: /^ISO8601/ });
  const relative = pane.getByRole('row', { name: /^相対/ });
  await expect(iso).toContainText('2025-12-31T23:59:50.000Z');
  await expect(relative).toContainText('10秒前');
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:05.000Z'));
  await expect(relative).toContainText('15秒前');
  await expect(iso).toContainText('2025-12-31T23:59:50.000Z');
});

test('UNIX時間：暦の加減算で日時の上限・下限に到達できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/time');
  await page.getByLabel('追加するタイムゾーン').fill('America/Phoenix');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByRole('group', { name: '機能' }).getByRole('button', { name: '差・足し引き' }).click();
  const base = page.getByLabel('基準の日時', { exact: true });
  const duration = page.getByLabel(/^期間/);
  const iso = page.getByRole('row', { name: /^ISO8601/ });
  for (const zone of ['UTC', 'Asia/Tokyo', 'America/Phoenix']) {
    await page.getByLabel('入力のタイムゾーン', { exact: true }).selectOption(zone);
    await base.fill('+275760-09-12T00:00:00.000Z');
    await duration.fill('1d');
    await expect(iso).toContainText('+275760-09-13T00:00:00.000Z');
    await base.fill('-271821-04-21T00:00:00.000Z');
    await duration.fill('-1d');
    await expect(iso).toContainText('-271821-04-20T00:00:00.000Z');
    await base.fill('+275760-09-13T00:00:00.000Z');
    await duration.fill('1d -24h');
    await expect(iso).toContainText('+275760-09-13T00:00:00.000Z');
    await base.fill('-271821-04-20T00:00:00.000Z');
    await duration.fill('-1d +24h');
    await expect(iso).toContainText('-271821-04-20T00:00:00.000Z');
  }
  await base.fill('+275760-09-13T00:00:00.000Z');
  await duration.fill('1d');
  await expect(page.locator('.error-text')).toContainText('日時の範囲を超えています');
  await expect(iso).toHaveCount(0);
});

/** UNIX時間の画面（拡張年、単位の指定と保存、タイムゾーン、差と期間の計算）の E2E */

test('UNIX時間：符号付き6桁の年の ISO 出力を日時入力で読み戻せる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/time');
  await page.getByRole('combobox', { name: 'エポック入力の単位', exact: true }).selectOption('ms');
  await page.getByRole('textbox', { name: 'エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）', exact: true }).fill('253402300800000');
  const iso = '+010000-01-01T00:00:00.000Z';
  await expect(page.getByText(iso, { exact: true })).toBeVisible();
  const datetime = page.getByRole('textbox', { name: '日時', exact: true });
  await datetime.fill(iso);
  const output = page.locator('.pane').last();
  await expect(output.getByRole('row', { name: /^ミリ秒/ })).toContainText('253402300800000');
  await datetime.fill('-000001-01-01T00:00:00.000Z');
  await expect(output.getByRole('row', { name: /^ミリ秒/ })).toContainText('-62198755200000');
  await datetime.fill('+010001-02-29T00:00:00.000Z');
  await expect(output.locator('.error-text')).toHaveText('存在しない日付です');
});

test('UNIX時間：短い数値をミリ秒として明示できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/time');
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）').fill('1500');
  const unit = page.getByLabel('エポック入力の単位');
  await expect(unit).toHaveValue('auto');
  await expect(page.getByText('1970-01-01T00:25:00.000Z', { exact: true })).toBeVisible();
  await unit.selectOption('ms');
  await expect(page.getByText('1970-01-01T00:00:01.500Z', { exact: true })).toBeVisible();
  /** 別のパネルへ移って戻っても、再読み込みしても、入力と単位の組を保ち、同じ時刻のまま */
  await page.getByRole('button', { name: '差・足し引き', exact: true }).click();
  await page.getByRole('button', { name: '変換', exact: true }).click();
  await expect(unit).toHaveValue('ms');
  await expect(page.getByText('1970-01-01T00:00:01.500Z', { exact: true })).toBeVisible();
  await page.reload();
  await expect(unit).toHaveValue('ms');
  await expect(page.getByText('1970-01-01T00:00:01.500Z', { exact: true })).toBeVisible();
});

test('回帰：UNIX時間：12桁のミリ秒は、秒として読んだことを示し、ミリ秒として読み直せる', CROSS_BROWSER, async ({ page }) => {
  /** 1990-01-01 のミリ秒（12桁）を、案内なく秒として読み、西暦2万年台の日時だけを表示していた */
  await page.goto('./#/time');
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）').fill('631152000000');
  await expect(page.getByText('桁数から秒として読みました。ミリ秒の値なら、単位を選んでください。')).toBeVisible();
  await page.getByRole('button', { name: 'ミリ秒として読む', exact: true }).click();
  await expect(page.getByLabel('エポック入力の単位')).toHaveValue('ms');
  await expect(page.getByText('1990-01-01T00:00:00.000Z', { exact: true })).toBeVisible();
  /** 単位を選んだ後は、案内を出さない */
  await expect(page.getByText('桁数から秒として読みました', { exact: false })).toHaveCount(0);
});

test('UNIX時間：不正な単位の保存値は自動に戻す', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dev-toolbox:pref:time:unit', JSON.stringify('minutes')));
  await page.goto('./#/time');
  await expect(page.getByLabel('エポック入力の単位')).toHaveValue('auto');
});

test('UNIX時間：タイムゾーンを追加すると、そのタイムゾーンでも表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/time');
  await page.getByLabel('追加するタイムゾーン').fill('America/New_York');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）').fill('1700000000');
  await expect(page.getByRole('row', { name: /America\/New_York/ }).first()).toContainText('2023-11-14 17:13:20 -05:00');
  await expect(page.getByRole('row', { name: /Asia\/Tokyo/ }).first()).toContainText('2023-11-15 07:13:20 +09:00');
  /** 存在しない名前は追加できない */
  await page.getByLabel('追加するタイムゾーン').fill('Mars/Olympus');
  await expect(page.getByText('タイムゾーン「Mars/Olympus」が見つかりません')).toBeVisible();
  await expect(page.getByRole('button', { name: '追加', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'America/New_York を外す' }).click();
  await expect(page.getByRole('row', { name: /America\/New_York/ })).toHaveCount(0);
});

test('UNIX時間：日時の差、期間の足し引き、ログの一括変換', async ({ page }) => {
  await page.goto('./#/time');
  await page.getByRole('group', { name: '機能' }).getByRole('button', { name: '差・足し引き' }).click();
  await page.getByLabel('開始').fill('2024-01-01 00:00');
  await page.getByLabel('終了').fill('2024-01-02 03:00');
  await expect(page.getByRole('row', { name: /^差/ })).toContainText('1日 3時間');
  await page.getByLabel('基準の日時').fill('2024-01-31 09:00');
  await page.getByLabel(/^期間/).fill('1mo');
  await expect(page.getByText('足した月にその日がないため、月末にそろえました')).toBeVisible();
  await expect(page.getByRole('row', { name: /Asia\/Tokyo/ }).first()).toContainText('2024-02-29 09:00:00 +09:00');

  await page.getByRole('group', { name: '機能' }).getByRole('button', { name: 'ログの一括変換' }).click();
  await page.getByLabel('ログ', { exact: true }).fill('1700000000 INFO started\nid=12345678901');
  await expect(page.getByLabel('変換結果')).toHaveValue('1700000000 [2023-11-15 07:13:20 +09:00] INFO started\nid=12345678901');
  await expect(page.getByText('1 個を変換')).toBeVisible();
});

test('UNIX時間：大きな期間の差を丸めず、範囲外の期間はエラーにする', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/time');
  await page.getByRole('group', { name: '機能' }).getByRole('button', { name: '差・足し引き' }).click();
  await page.getByLabel('基準の日時', { exact: true }).fill('2026-01-01 00:00:00 UTC');
  const duration = page.getByLabel(/^期間/);
  await duration.fill('9007199254740993ms -9007199254740992ms');
  const iso = page.getByRole('row', { name: /^ISO8601/ });
  await expect(iso).toContainText('2026-01-01T00:00:00.001Z');
  await duration.fill('9007199254740992ms');
  await expect(page.locator('.error-text')).toContainText('期間の値が大きすぎます');
  await expect(iso).toHaveCount(0);
  await duration.fill('1ms');
  await expect(iso).toContainText('2026-01-01T00:00:00.001Z');
});

test('UNIX時間：小文字で入力したタイムゾーン名は正式な表記にそろえ、重複して追加しない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/time');
  await page.getByLabel('追加するタイムゾーン').fill('asia/tokyo');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('button', { name: /を外す$/ })).toHaveCount(2);
  await page.getByLabel('追加するタイムゾーン').fill('america/new_york');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByRole('button', { name: 'America/New_York を外す' })).toBeVisible();
});

test('UNIX時間：1秒未満の端数がある時刻は、各タイムゾーンの表示にも端数を残し、貼り戻しても同じ時刻になる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/time');
  const [epochPane, datePane] = [page.locator('.pane').first(), page.locator('.pane').last()];
  /** 秒単位のエポックでも、小数部があればミリ秒まで表示する */
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）').fill('1700000000.123');
  const tokyo = epochPane.getByRole('row', { name: /Asia\/Tokyo/ });
  await expect(tokyo).toContainText('2023-11-15 07:13:20.123 +09:00');
  const datetime = page.getByRole('textbox', { name: '日時', exact: true });
  await datetime.fill('2023-11-15 07:13:20.123 +09:00');
  await expect(datePane.getByRole('row', { name: /^ミリ秒/ })).toContainText('1700000000123');
  /** 日時入力の端数も、拡張年の表示に残す */
  await datetime.fill('+010000-01-01T00:00:00.123Z');
  const utc = datePane.getByRole('row', { name: /UTC/ });
  await expect(utc).toContainText('+010000-01-01 00:00:00.123 +00:00');
  await datetime.fill('+010000-01-01 00:00:00.123 +00:00');
  await expect(datePane.getByRole('row', { name: /^ミリ秒/ })).toContainText('253402300800123');
  /** 端数のない時刻は、秒までの表示のまま */
  await datetime.fill('2024-01-01T00:00:00Z');
  await expect(utc).toContainText('2024-01-01 00:00:00 +00:00');
});

test('UNIX時間：ミリ秒で書いたエポック時間は、端数がなくても一括変換と同じく「.000」まで表示する', async ({ page }) => {
  await page.goto('./#/time');
  const epochPane = page.locator('.pane').first();
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）').fill('1700000000000');
  await expect(epochPane.getByRole('row', { name: /Asia\/Tokyo/ })).toContainText('2023-11-15 07:13:20.000 +09:00');
  await page.getByLabel('エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）').fill('1700000000');
  await expect(epochPane.getByRole('row', { name: /Asia\/Tokyo/ })).toContainText('2023-11-15 07:13:20 +09:00');
});
