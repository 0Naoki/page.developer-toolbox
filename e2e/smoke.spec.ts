/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R001] 全ツールの表示：ツールの一覧（src/toolCatalog.ts）の全項目の見出し、外部通信・CSP違反・実行時エラー。不具合の報告に書く版の表示。配布物に同梱する第三者のライセンス
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { TOOLS, settleRendering } from './app';
import { ANNOUNCE_DELAY_MS, PUBLISH_DELAY_MS } from '../src/lib/announcements';

for (const [id, title] of TOOLS) {
  test(`${title} が表示され、エラー・CSP違反・外部通信がない`, CROSS_BROWSER, async ({ page }) => {
    await page.goto(`./#/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    const calculation = page.locator('[data-calculation-state]');
    if (await calculation.count()) await expect(calculation).toHaveAttribute('data-calculation-state', 'done');
    await settleRendering(page);
  });
}

test('サイドバーの末尾に、不具合の報告に書く版を表示する', async ({ page }) => {
  await page.goto('./');
  /** CI のビルドはコミットの先頭7文字、手元のビルドは local */
  await expect(page.getByText(/^版：v\d+\.\d+\.\d+（(?:[0-9a-f]{7}|local)）$/)).toBeVisible();
});

test('配布物に、React などの第三者のライセンス（著作権表示）を同梱する', async ({ request }) => {
  const response = await request.get('./THIRD_PARTY_LICENSES.txt');
  expect(response.ok()).toBe(true);
  const text = await response.text();
  /** 画面のコードに入る依存パッケージ（package.json の dependencies）と、その著作権表示 */
  for (const name of ['react', 'react-dom', 'react-router']) {
    expect(text.split('\n').some((line) => new RegExp(`^${name}@\\d+\\.\\d+\\.\\d+（MIT）$`).test(line)), name).toBe(true);
  }
  expect(text).toContain('Copyright (c) Meta Platforms, Inc. and affiliates.');
});

/** 「サンプル」のボタンで、入力の例を入れて結果まで表示できる（入力の値は各ツールの画面のファイルにある架空の値） */
test.describe('サンプルの入力', () => {
  const noError = async (page: import('@playwright/test').Page) => {
    await expect(page.locator('.error-text, .error-box')).toHaveCount(0);
  };

  test('Base64：日本語を含む文をエンコードする', async ({ page }) => {
    await page.goto('./#/base64');
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveValue(/^こんにちは、Dev Toolbox!/);
    await expect(page.getByText(/^44GT44KT44Gr44Gh44Gv/)).toBeVisible();
    await noError(page);
  });

  test('進数変換：負の数の2の補数を表示する', async ({ page }) => {
    await page.goto('./#/radix');
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '16進数', exact: true })).toHaveValue('FFFF FFD6');
    await noError(page);
  });

  test('UNIX時間：ログの秒・ミリ秒・マイクロ秒を変換し、ID は変換しない', async ({ page }) => {
    await page.goto('./#/time');
    await page.getByRole('button', { name: 'ログの一括変換', exact: true }).click();
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.getByText('3 個を変換', { exact: true })).toBeVisible();
    await noError(page);
  });

  test('サブネット：ネットワークと、含まれるかの判定を表示する', async ({ page }) => {
    await page.goto('./#/subnet');
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.getByText('192.168.10.0/24 に含まれます', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '集約・範囲変換', exact: true }).click();
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.getByText('2001:db8::/32', { exact: false }).first()).toBeVisible();
    await noError(page);
  });

  test('ハッシュ：SHA-256 を表示する', async ({ page }) => {
    await page.goto('./#/hash');
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.getByText('585c6341eae3f81b5876dc0a9296c437b0f378c6650a88c64fee5c2b8a1c92cc', { exact: true })).toBeVisible();
    await noError(page);
  });

  test('JWT：サンプルの秘密鍵で署名を検証できる', async ({ page }) => {
    await page.goto('./#/jwt');
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await page.getByRole('button', { name: 'サンプルの秘密鍵を入れる', exact: true }).click();
    await expect(page.getByText('署名は正しく、この秘密鍵で作られています', { exact: false })).toBeVisible();
    /** 秘密鍵を入れた後は、ボタンを出さない */
    await expect(page.getByRole('button', { name: 'サンプルの秘密鍵を入れる', exact: true })).toHaveCount(0);
    await noError(page);
  });

  test('証明書：自己署名の CA 証明書を表示し、署名を確かめる', async ({ page }) => {
    await page.goto('./#/cert');
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.getByText('✓ 正しい', { exact: true })).toBeVisible();
    await expect(page.getByText('Dev Toolbox Test Root CA', { exact: false }).first()).toBeVisible();
    await noError(page);
  });
});

/** エラーと判定の結果を、画面に1つだけある読み上げの領域（aria-live）で、入力が止まってから読む（src/components/LiveAnnouncer.tsx） */
test.describe('読み上げ', () => {
  const liveRegion = (page: import('@playwright/test').Page) => page.locator('[data-live-region]');

  test('公開待ちの間に直したエラーは読み上げず、次のエラーは読める', CROSS_BROWSER, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto('./#/radix');
    const input = page.getByRole('textbox', { name: '10進数', exact: true });
    await input.waitFor();
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    await input.fill('12x');
    await expect(page.locator('.error-text')).toHaveCount(1);
    await page.clock.runFor(ANNOUNCE_DELAY_MS);
    await input.fill('12');
    await expect(page.locator('.error-text')).toHaveCount(0);
    await page.clock.runFor(PUBLISH_DELAY_MS);
    await expect(liveRegion(page)).toHaveText('');
    await input.fill('13x');
    await page.clock.runFor(ANNOUNCE_DELAY_MS + PUBLISH_DELAY_MS);
    await expect(liveRegion(page)).toHaveText(/^エラー：/);
  });

  test('入力のエラーを、入力が止まってから読み上げる', async ({ page }) => {
    await page.goto('./#/radix');
    await expect(liveRegion(page)).toHaveAttribute('aria-live', 'polite');
    await page.getByRole('textbox', { name: '10進数', exact: true }).fill('12x');
    await expect(liveRegion(page)).toHaveText(/^エラー：/);
    /** 直すと、エラーは読まない（領域の文言は最後に読んだもののまま） */
    await page.getByRole('textbox', { name: '10進数', exact: true }).fill('12');
    await expect(page.locator('.error-text')).toHaveCount(0);
  });

  test('進数変換：未入力の初期表示ではエラーを出さず、不正な値のエラーをビット演算で重ねない', async ({ page }) => {
    await page.goto('./#/radix');
    await page.getByRole('textbox', { name: '10進数', exact: true }).fill('');
    await expect(page.getByText('上の欄に値を入力すると、ここで計算します。')).toBeVisible();
    await expect(page.locator('.error-text')).toHaveCount(0);
    await page.getByRole('textbox', { name: '10進数', exact: true }).fill('12x');
    await expect(page.locator('.error-text')).toHaveCount(1);
  });

  test('判定の結果（含まれるか）を読み上げる', async ({ page }) => {
    await page.goto('./#/subnet');
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(liveRegion(page)).toHaveText('192.168.10.0/24 に含まれます');
    await page.getByRole('textbox', { name: '判定するアドレス', exact: true }).fill('10.0.0.1');
    await expect(liveRegion(page)).toHaveText('192.168.10.0/24 に含まれません');
  });

  test('同時に出た複数のエラーは、まとめて読む', async ({ page }) => {
    await page.goto('./#/subnet');
    await page.getByRole('button', { name: '集約・範囲変換', exact: true }).click();
    await page.getByRole('textbox', { name: 'CIDR・アドレスの範囲・アドレスの一覧（1行に1つ）', exact: true }).fill('x\ny\nz\nw');
    await expect(liveRegion(page)).toHaveText(/^エラー：1行目：.*。エラー：2行目：.*。エラー：3行目：.*。ほか 1 件$/);
  });
});
