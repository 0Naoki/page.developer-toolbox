/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R022] 正規表現：空マッチ、キャプチャ・置換、打ち切り後の再計算と古い結果の破棄、上限を超える入力を Worker へ渡す前に断ること、長いマッチを省略して全文をコピーできること、不正な保存フラグは既定に戻し、すべて外した設定は保つこと。長い正規表現の書き方の誤りでも、理由を表示の上限で切らないこと（あわせて `src/tools/regex/logic.test.ts`）
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { pasteLargeInput } from './paste';
import { captureClipboard, copiedLength } from './clipboard';

test('正規表現：上限超過を転送前に検出し、置換結果のコピーには全文を使う', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (request) {
      document.documentElement.dataset.regexRequest = 'sent';
      post.call(this, request);
    };
  });
  await captureClipboard(page);
  await page.goto('./#/regex');
  await pasteLargeInput(page, '置換文字列', 'x'.repeat(100_001));
  await expect(page.getByRole('alert')).toHaveText('置換文字列は10万文字までです');
  expect(await page.locator('html').getAttribute('data-regex-request')).toBeNull();
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('^.+$');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('a'.repeat(10_000));
  await page.getByRole('textbox', { name: '置換文字列', exact: true }).fill('$&'.repeat(10));
  const output = page.getByRole('textbox', { name: '置換結果', exact: true });
  await expect.poll(async () => (await output.inputValue()).length).toBe(50_000);
  await page.getByRole('button', { name: 'コピー', exact: true }).click();
  await expect.poll(() => copiedLength(page)).toBe(100_000);
  /** 長いマッチは全文を描画せず、省略を示して全文をコピーで取り出せる */
  const match = page.locator('.regex-match pre');
  await expect(match).toContainText('（以降省略。全10,000文字）');
  expect((await match.textContent())?.length).toBeLessThan(3_000);
  await match.getByRole('button', { name: '全文をコピー', exact: true }).click();
  await expect.poll(() => copiedLength(page)).toBe(10_000);
});

test('正規表現：マッチ・名前付きキャプチャ・置換をリアルタイムに表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/regex');
  await page.getByRole('button', { name: 'サンプル', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('2件のマッチ');
  await expect(page.locator('.regex-hit')).toHaveText(['apple=12', 'banana=34']);
  const captures = page.getByRole('table', { name: 'マッチ 1 のキャプチャ' });
  await expect(captures.getByRole('row', { name: '$<name> apple 0〜5', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '置換結果', exact: true })).toHaveValue('apple: 12\nbanana: 34');
  await page.getByRole('textbox', { name: '置換文字列', exact: true }).fill('[$2]');
  await expect(page.getByRole('textbox', { name: '置換結果', exact: true })).toHaveValue('[12]\n[34]');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('orange=56');
  await expect(page.getByRole('status')).toHaveText('1件のマッチ');
  await expect(page.locator('.regex-hit')).toHaveText(['orange=56']);
  await expect(page.getByRole('textbox', { name: '置換結果', exact: true })).toHaveValue('[56]');
  const storage = await page.evaluate(() => ({ local: localStorage.getItem('dev-toolbox:input:regex:text'), session: sessionStorage.getItem('dev-toolbox:input:regex:text') }));
  expect(storage).toEqual({ local: null, session: 'orange=56' });
});

test('正規表現：名前付きキャプチャがない置換記法もJavaScript標準と一致する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/regex');
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('(a)');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('a');
  const replacement = page.getByRole('textbox', { name: '置換文字列', exact: true });
  const output = page.getByRole('textbox', { name: '置換結果', exact: true });
  await replacement.fill('$<$1>');
  await expect(output).toHaveValue('$<a>');
  await replacement.fill('$<$$>');
  await expect(output).toHaveValue('$<$>');
});

test('正規表現：初期状態と空入力の評価を区別し、クリアすると初期状態に戻る', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/regex');
  const status = page.getByRole('status');
  const replacement = page.getByRole('textbox', { name: '置換文字列', exact: true });
  const output = page.getByRole('textbox', { name: '置換結果', exact: true });
  await expect(status).toHaveText('正規表現とテスト文字列を入力してください');
  await replacement.fill('X');
  await expect(status).toHaveText('1件のマッチ');
  await expect(page.locator('.regex-empty')).toHaveCount(1);
  await expect(output).toHaveValue('X');
  await replacement.fill('');
  await expect(status).toHaveText('1件のマッチ');
  await expect(output).toHaveValue('');
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  await expect(status).toHaveText('正規表現とテスト文字列を入力してください');
  await expect(page.locator('.regex-empty')).toHaveCount(0);
});

test('正規表現：空のマッチ・構文エラー・入力中のHTMLを安全に表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/regex');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('😀');
  await page.getByRole('checkbox', { name: /u Unicode/ }).check();
  await expect(page.getByRole('status')).toHaveText('2件のマッチ');
  await expect(page.locator('.regex-empty')).toHaveCount(2);
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('[');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('.+');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('<img src="https://outside.test/x">');
  await expect(page.locator('.regex-hit')).toHaveText(['<img src="https://outside.test/x">']);
  await expect(page.locator('main img')).toHaveCount(0);
});

test('正規表現：重い計算を中断し、その後も検索を続けられる', CROSS_BROWSER, async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown): void {
        const input = message as { pattern?: string; text?: string };
        /**
         * 同じ式でもエンジンによって早期に計算を終えるため、応答のない計算を模擬する。
         * Worker の起動・終了と、次の正常な式の計算はブラウザの実装を使う。
         */
        if (input.pattern === '^(a+)+$' && input.text?.endsWith('!')) {
          (window as Window & { regexHeld?: boolean }).regexHeld = true;
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto('./#/regex');
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('^(a+)+$');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('a'.repeat(100) + '!');
  await page.waitForFunction(() => (window as Window & { regexHeld?: boolean }).regexHeld);
  await page.clock.fastForward(2000);
  await expect(page.getByRole('alert')).toContainText('計算を2秒で打ち切りました');
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('!');
  await expect(page.getByRole('status')).toHaveText('1件のマッチ');
  await expect(page.locator('.regex-hit')).toHaveText(['!']);
});

test('正規表現：計算途中の式を変更すると古い結果を破棄する', CROSS_BROWSER, async ({ page }) => {
  await page.clock.install();
  await page.goto('./#/regex');
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('^(a+)+$');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('a'.repeat(100) + '!');
  await expect(page.getByRole('status')).toHaveText('計算中…');
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('!');
  await expect(page.getByRole('status')).toHaveText('1件のマッチ');
  await page.clock.fastForward(2300);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('1件のマッチ');
});

test('正規表現：表示の上限を超えるマッチも、すべて置換する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/regex');
  await page.getByRole('textbox', { name: '正規表現', exact: true }).fill('a');
  await page.getByRole('textbox', { name: 'テスト文字列', exact: true }).fill('a'.repeat(1200));
  await page.getByRole('textbox', { name: '置換文字列', exact: true }).fill('b');
  await expect(page.getByRole('status')).toHaveText('1,200件のマッチ（先頭500件を表示）');
  await expect(page.getByRole('textbox', { name: '置換結果', exact: true })).toHaveValue('b'.repeat(1200));
});

test('正規表現：保存したフラグが不正なら既定に戻し、すべて外した状態は保つ', async ({ page }) => {
  /** "invalid" を文字列として受け付けると、含まれる i だけがオンになり g がオフになる */
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e:flags-set')) {
      localStorage.setItem('dev-toolbox:pref:regex:flags', JSON.stringify('invalid'));
      sessionStorage.setItem('e2e:flags-set', '1');
    }
  });
  await page.goto('./#/regex');
  const flag = (name: string) => page.getByRole('checkbox', { name: new RegExp(`^${name} `) });
  await expect(flag('g')).toBeChecked();
  await expect(flag('i')).not.toBeChecked();
  /** すべて外した状態（空文字）は有効な設定として、再読み込み後も保つ */
  await flag('g').uncheck();
  await page.reload();
  await expect(flag('g')).not.toBeChecked();
  await expect(flag('i')).not.toBeChecked();
});
