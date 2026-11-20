/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R026] JSON整形・和暦・テキスト差分：JSON整形で値が変わらないこと（ツリー表示でも元の表記を保ち、値の場所と値をコピーできること。ほかのツールの結果を URL に載せずに受け取り、二重に受け取らないこと）、1873年より前の生年月日でもエラーを表示して画面が消えないこと、比較結果が変わると展開した箇所を閉じること
 *   日本時間の誕生日とタブ復帰で空の基準日を更新し、明示した基準日は保つこと。
 * - [R036] UUID の形式と時刻：片側の括弧を拒否し、RFC 9562 の v6 の時刻を表示すること。v4 の時刻なしと v8 の解析未対応を区別し、不正な入力から復帰すること。
 * - [R038] 日本時間の日付・年の変更 × 誕生日・空の基準日・タブ復帰：空の基準日は新しい今日で判定し、入力した基準日・営業日の入力は保つ。年の選択範囲は新年に更新する（あわせて `e2e/business-days.spec.ts`）
 * - [R039] UUID の括弧・ハイフン × バージョン・バリアント：形式が不完全なら拒否する。RFC の v1・v6・v7 と ULID の時刻、時刻なし、解析未対応を区別する（あわせて `src/tools/uuid/logic.test.ts`）
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { captureClipboard, copiedText } from './clipboard';

test('和暦：日付変更とタブへの復帰で今日を更新し、明示した基準日は保つ', CROSS_BROWSER, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-12T14:58:00Z') });
  await page.goto('./#/wareki');
  await page.getByPlaceholder('1993-04-01 / H5.4.1').fill('2000-11-13');
  const age = page.locator('.big-result strong');
  await expect(age).toHaveText('25');
  await page.clock.fastForward(120000);
  await expect(age).toHaveText('26');
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '西暦の日付', exact: true })).toHaveValue('2026-11-13');
  await page.clock.setSystemTime(new Date('2027-11-13T01:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(age).toHaveText('27');
  await page.clock.setSystemTime(new Date('2028-11-13T01:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(age).toHaveText('28');
  await page.getByRole('textbox', { name: '基準日（空欄なら今日）', exact: true }).fill('2026-11-12');
  await expect(age).toHaveText('25');
  await page.clock.fastForward(86400000);
  await expect(age).toHaveText('25');
});

test('UUID：v6 の時刻・時刻なし・解析未対応を区別し、不完全な形式から復帰する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/uuid');
  const input = page.getByRole('textbox', { name: '解析する UUID または ULID', exact: true });
  await input.fill('{550e8400-e29b-41d4-a716-446655440000');
  await expect(page.locator('.error-text')).toBeVisible();
  await input.fill('1EC9414C-232A-6B00-B3C8-9F6BDECED846');
  const time = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '生成日時', exact: true }) });
  /** 日時と、エポックミリ秒（1645557742000）は別の行で、それぞれコピーできる */
  await expect(time).toContainText('2022-02-23 04:22:22 JST');
  const millis = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '生成日時（エポックミリ秒）', exact: true }) });
  await expect(millis).toContainText('1645557742000');
  await expect(millis.getByRole('button')).toHaveCount(1);
  await input.fill('550e8400-e29b-41d4-a716-446655440000');
  await expect(time).toContainText('このバージョンは時刻を含みません');
  await input.fill('550e8400-e29b-81d4-a716-446655440000');
  await expect(time).toContainText('この形式の時刻解析には未対応です');
});

/** ツール別の spec がない画面（JSON整形・和暦・テキスト差分・UUID）の E2E */

test('JSON整形で値が変わらない', async ({ page }) => {
  await page.goto('./#/json');
  await page.locator('textarea').first().fill('{"id":9007199254740993,"price":1.10}');
  await expect(page.locator('textarea').nth(1)).toHaveValue('{\n  "id": 9007199254740993,\n  "price": 1.10\n}');
});

test('和暦：1873年より前の生年月日はエラーを表示し、画面は消えない', async ({ page }) => {
  await page.goto('./#/wareki');
  await page.getByPlaceholder('1993-04-01 / H5.4.1').fill('1850-01-01');
  await expect(page.getByText('明治6年（1873年）1月1日より前は旧暦のため対応していません')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('和暦 ⇔ 西暦');
});

test('テキスト差分：比較結果が変わると、展開した箇所を閉じる', async ({ page }) => {
  await page.goto('./#/diff');
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  await page.getByRole('textbox', { name: '変更前', exact: true }).fill(lines.join('\n'));
  const after = page.getByRole('textbox', { name: '変更後', exact: true });
  await after.fill(['changed 1', ...lines.slice(1)].join('\n'));
  const fold = page.getByRole('button', { name: /変更のない \d+ 行を表示/ });
  await fold.click();
  await expect(fold).toHaveCount(0);

  /** 同じ位置に折りたたみができる編集でも、前に展開した位置を引き継がない */
  await after.fill(['changed 2', ...lines.slice(1)].join('\n'));
  await expect(fold).toHaveCount(1);
});

test('JSON整形：ツリーで開いた値の場所（JSONPath）と、元の表記の値をコピーできる', CROSS_BROWSER, async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/json');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('{"user":{"id":9007199254740993,"first name":"山田","roles":["admin","dev"]},"items":[' + Array.from({ length: 150 }, (_, i) => i).join(',') + ']}');
  await page.getByRole('group', { name: '表示', exact: true }).getByRole('button', { name: 'ツリー', exact: true }).click();
  const tree = page.getByRole('list', { name: 'JSON のツリー', exact: true });
  await expect(tree).toBeVisible();
  /** 根だけが開いていて、子は閉じている */
  await expect(tree.getByRole('button', { name: 'user を開く', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await tree.getByRole('button', { name: 'user を開く', exact: true }).click();
  /** 大きな整数も元の表記のまま表示し、値をコピーできる */
  await expect(tree.getByText('9007199254740993', { exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'roles を開く', exact: true }).click();
  const admin = tree.locator('li').filter({ hasText: '"admin"' }).last();
  await admin.getByRole('button', { name: 'パスをコピー', exact: true }).click();
  await expect.poll(() => copiedText(page)).toBe('$.user.roles[0]');
  await admin.getByRole('button', { name: '値をコピー', exact: true }).click();
  await expect.poll(() => copiedText(page)).toBe('"admin"');
  /** 識別子でないキーは ["…"] の形にする */
  const firstName = tree.locator('li').filter({ hasText: 'first name' }).last();
  await firstName.getByRole('button', { name: 'パスをコピー', exact: true }).click();
  await expect.poll(() => copiedText(page)).toBe('$.user["first name"]');
  /** 大きな配列は100件ずつ表示する */
  await tree.getByRole('button', { name: 'items を開く', exact: true }).click();
  await expect(tree.getByText('残り 50 件', { exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'さらに 50 件を表示', exact: true }).click();
  await expect(tree.getByText('[149]', { exact: true })).toBeVisible();
  await expect(tree.getByText(/^残り/)).toHaveCount(0);
  /** テキストの表示に戻せる */
  await page.getByRole('group', { name: '表示', exact: true }).getByRole('button', { name: 'テキスト', exact: true }).click();
  await expect(tree).toHaveCount(0);
});

test('JSON整形で開く：JWT・Base64・CSV の結果を、URL に載せずに JSON整形の入力として開く', CROSS_BROWSER, async ({ page }) => {
  const jsonInput = page.getByRole('textbox', { name: '入力', exact: true });
  /** JWT のペイロード */
  await page.goto('./#/jwt');
  await page.getByRole('button', { name: 'サンプル', exact: true }).click();
  await page.getByRole('region', { name: 'ペイロード', exact: true }).waitFor();
  const payloadPane = page.locator('.pane').filter({ has: page.getByRole('region', { name: 'ペイロード', exact: true }) });
  await payloadPane.getByRole('button', { name: 'JSON整形で開く', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('JSON整形');
  await expect(jsonInput).toHaveValue(/"sub": "1234567890"/);
  /** 渡した値は URL に載らない */
  expect(new URL(page.url()).hash).toBe('#/json');
  /** 戻ってからもう一度 JSON整形を開いても、同じ値を二重に受け取らない（今の入力のまま） */
  await jsonInput.fill('{"edited":true}');
  await page.goto('./#/base64');
  await page.goto('./#/json');
  await expect(jsonInput).toHaveValue('{"edited":true}');

  /** Base64 をデコードしたテキスト */
  await page.goto('./#/base64');
  await page.getByRole('group', { name: '方向', exact: true }).getByRole('button', { name: 'デコード', exact: true }).click();
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('eyJiYXNlNjQiOnRydWV9');
  await page.getByRole('button', { name: 'JSON整形で開く', exact: true }).click();
  await expect(jsonInput).toHaveValue('{"base64":true}');

  /** CSV から変換した JSON */
  await page.goto('./#/csv');
  await page.getByRole('button', { name: 'サンプル', exact: true }).click();
  await page.getByRole('button', { name: 'JSON整形で開く', exact: true }).click();
  await expect(jsonInput).toHaveValue(/"社員番号"/);
});
