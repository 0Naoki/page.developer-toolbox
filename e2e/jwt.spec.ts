/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R024] JWT：秘密鍵・公開鍵（証明書）での署名照合、トークンと鍵の非保存、上限を超える公開鍵を全文描画しないこと、期限の更新、長いクレームの表示の省略と全文のコピー。長い alg・小数の桁が長い時刻を、バッジ・表・警告・鍵の欄の見出しで抜粋にすること。
 *   JWK の alg・use・crv が長くても、検証できない理由を表示上限内に残すこと。公開鍵を読み込めないときは「署名が一致しない」でなく「検証できない」とすること
 *   空白だけのUTF-8鍵もHMACの署名検証に使い、同じバイト列をBase64で入力しても一致すること。空文字・Base64と公開鍵の空白だけの入力は未入力とすること。
 *   （あわせて `e2e/cert.spec.ts`・`src/tools/jwt-decoder/verify.test.ts`）
 * - [R049] 秘密鍵・共通鍵の混在 × kid 不一致・alg 不一致 × 配列の順序：選択されない鍵でも入力全体を拒否する。公開鍵だけに直した後は再検証できる（あわせて `src/tools/jwt-decoder/verify.test.ts`）
 */
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { RSA_JWK, SECRET, TOKENS, base64Url } from '../src/tools/jwt-decoder/tokens.fixtures';
import { pasteLargeInput } from './paste';
import { captureClipboard, copiedText, copiedLength } from './clipboard';

test('JWT：長いJWKの値を抜粋しても、検証できない理由を表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/jwt');
  await page.getByLabel('トークン', { exact: true }).fill(TOKENS.RS256);
  for (const [field, reason] of [['alg', '異なります'], ['use', '署名用（sig）ではありません'], ['crv', '必要な鍵（RSA）と合いません']] as const) {
    const jwk = field === 'crv' ? { kty: 'EC', crv: 'x'.repeat(2000), x: 'AQ', y: 'AQ' } : { ...RSA_JWK, [field]: 'x'.repeat(2000) };
    await page.getByLabel('公開鍵', { exact: true }).fill(JSON.stringify(jwk));
    const result = page.getByRole('status');
    await expect(result).toContainText(reason);
    expect((await result.textContent())!.length).toBeLessThanOrEqual(1000);
  }
  await page.getByLabel('公開鍵', { exact: true }).fill(JSON.stringify(RSA_JWK));
  await expect(page.getByText('署名は正しい', { exact: true })).toBeVisible();
});

test('JWT：上限を超える公開鍵を貼っても全文を描画せず、拒否した後に直して検証できる', async ({ page }) => {
  await page.goto('./#/jwt');
  await page.getByLabel('トークン', { exact: true }).fill(TOKENS.RS256);
  /** 読み込みの上限（65,536単位）は貼り付けの量を制限しないため、欄の表示が先頭までになることを確かめる */
  await pasteLargeInput(page, '公開鍵', `-----BEGIN PUBLIC KEY-----\n${'A'.repeat(200_000)}\n-----END PUBLIC KEY-----`);
  await expect(page.locator('.error-text')).toContainText('公開鍵が大きすぎます');
  expect((await page.getByLabel('公開鍵', { exact: true }).inputValue()).length).toBeLessThanOrEqual(50_000);
  await page.getByRole('button', { name: '全文を編集', exact: true }).click();
  await page.getByLabel('公開鍵', { exact: true }).fill(JSON.stringify(RSA_JWK));
  await expect(page.getByText('署名は正しい', { exact: true })).toBeVisible();
});

test('JWT：選択されない鍵に秘密の値があっても入力全体を拒否する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/jwt');
  await page.getByLabel('トークン', { exact: true }).fill(TOKENS.RS256);
  const key = page.getByLabel('公開鍵', { exact: true });
  const publicSet = { keys: [RSA_JWK] };
  await key.fill(JSON.stringify(publicSet));
  await expect(page.getByText('署名は正しい', { exact: true })).toBeVisible();
  await key.fill(JSON.stringify({ keys: [RSA_JWK, { ...RSA_JWK, kid: 'other', d: 'AAAA' }] }));
  await expect(page.locator('.error-text')).toContainText('秘密鍵の値（d など）');
  await expect(page.getByText('署名は正しい', { exact: true })).toHaveCount(0);
  await key.fill(JSON.stringify(publicSet));
  await expect(page.getByText('署名は正しい', { exact: true })).toBeVisible();
});

/** JWT デコーダーの E2E（署名の検証、鍵とトークンを保存しないこと、期限の表示、長いクレームの表示とコピー） */

test('JWT：長いクレームの表示を制限し、クレームとペイロードのどちらのコピーも全文を保持する', CROSS_BROWSER, async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/jwt');
  const sub = 'x'.repeat(55_000);
  await pasteLargeInput(page, 'トークン', `${base64Url(JSON.stringify({ alg: 'none' }))}.${base64Url(JSON.stringify({ sub }))}.`);
  const claim = page.locator('.jwt-claims tbody td .mono');
  /** 表示は先頭50,000単位までで、省略したことと元の長さを示す */
  /** 5万文字を超える本文の比較は WebKit で遅いため、省略の印（元の長さ）と、コピーした長さで確かめる */
  await expect(claim.locator('.muted')).toHaveText(`（以降省略。全${sub.length.toLocaleString('ja-JP')}文字）`);
  /** クレームの値は、その場で全文をコピーできる */
  await claim.getByRole('button', { name: '全文をコピー', exact: true }).click();
  await expect.poll(() => copiedLength(page)).toBe(sub.length);
  await page.locator('.pane-head').filter({ hasText: 'ペイロード' }).getByRole('button', { name: 'コピー', exact: true }).click();
  /** ペイロードは JSON の全文をコピーし、クレームの値も切り詰めない */
  await expect.poll(async () => (JSON.parse((await copiedText(page)) ?? '{}') as { sub?: string }).sub?.length).toBe(sub.length);
});

test('JWT：長い alg と小数の桁が長い exp は、バッジ・表・警告・見出しを抜粋にする', CROSS_BROWSER, async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/jwt');
  const alg = 'A'.repeat(200_000);
  const exp = `1700000000000.${'0'.repeat(200_000)}`;
  await pasteLargeInput(page, 'トークン', `${base64Url(JSON.stringify({ alg }))}.${base64Url(`{"exp":${exp}}`)}.c2ln`);
  /** バッジ・鍵の欄の見出しは、抜粋（256単位）にする */
  const badge = page.locator('.status-row .badge').filter({ hasText: 'alg: ' });
  await expect(badge).toHaveText(`alg: ${'A'.repeat(255)}…`);
  await expect(page.locator('.jwt-verify .field-label')).toContainText(`公開鍵（${'A'.repeat(255)}…。`);
  /** 時刻の表の元の表記は先頭2,000単位までにし、全文はコピーで取り出す */
  const epochCell = page.locator('table.kv').first().locator('td.mono');
  await expect(epochCell.locator('.muted')).toHaveText(`（以降省略。全${exp.length.toLocaleString('ja-JP')}文字）`);
  expect(await epochCell.evaluate((td) => td.textContent?.length ?? 0)).toBeLessThan(2_100);
  await epochCell.getByRole('button', { name: '全文をコピー', exact: true }).click();
  await expect.poll(() => copiedLength(page)).toBe(exp.length);
  /** ミリ秒の警告にも抜粋だけを入れる */
  const warning = page.locator('.notice.warn').filter({ hasText: 'ミリ秒で書かれている' });
  expect(await warning.evaluate((el) => el.textContent?.length ?? 0)).toBeLessThan(500);
  /**
   * 画面全体でも、20万単位の値を丸ごと描画していない。トークンの入力欄・ヘッダ・ペイロードの表示が各50,000単位まであるため、
   * 上限は20万単位にする（抜粋にしなければ、バッジ・表・警告・見出しの4か所で80万単位を超える）
   */
  expect(await page.locator('main').evaluate((el) => el.textContent?.length ?? 0)).toBeLessThan(200_000);
});

test('JWT：数値でない exp は「exp なし」ではなく不正と表示する', async ({ page }) => {
  await page.goto('./#/jwt');
  const payload = base64Url('{"exp":"0"}');
  await page.getByLabel('トークン').fill(`eyJhbGciOiJIUzI1NiJ9.${payload}.c2ln`);
  await expect(page.getByText('exp が不正', { exact: true })).toBeVisible();
  await expect(page.getByText('exp なし', { exact: true })).toHaveCount(0);
  await expect(page.getByText('exp が 数値ではありません（"0"）', { exact: false })).toBeVisible();
});

test('JWT：HS256 の秘密鍵の欄に公開鍵を入れると、検証せずに警告する', async ({ page }) => {
  await page.goto('./#/jwt');
  await page.getByLabel('トークン').fill(TOKENS.HS256);
  await page.getByLabel('秘密鍵', { exact: true }).fill(JSON.stringify(RSA_JWK));
  await expect(page.getByText('公開鍵を HMAC の鍵にすると', { exact: false })).toBeVisible();
  await expect(page.getByText('署名は未検証')).toBeVisible();
  await expect(page.getByText('署名は正しく', { exact: false })).toHaveCount(0);
});

test('JWT：空白だけのUTF-8鍵と同じBase64鍵で検証でき、未入力の判定も保つ', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/jwt');
  const secret = ' '.repeat(32);
  /** 架空の空白32バイトで実際に署名し、画面と独立したWeb Cryptoの結果を検証対象にする。 */
  const { token, base64Key } = await page.evaluate(async (secret) => {
    const base64url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const signingInput = `${base64url('{"alg":"HS256"}')}.${base64url('{"sub":"space-key-regression"}')}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)));
    const signature = base64url(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
    return { token: `${signingInput}.${signature}`, base64Key: btoa(secret) };
  }, secret);
  const input = page.getByLabel('秘密鍵', { exact: true });
  const format = page.getByRole('group', { name: '秘密鍵の形式', exact: true });
  const valid = page.getByRole('status').filter({ hasText: '✓ 署名は正しく、この秘密鍵で作られています' });
  const unverified = page.getByText('署名は未検証', { exact: true });
  await page.getByLabel('トークン', { exact: true }).fill(token);
  await expect(unverified).toBeVisible();
  await input.fill(secret);
  await expect(valid).toBeVisible();
  await format.getByRole('button', { name: 'Base64', exact: true }).click();
  await expect(unverified).toBeVisible();
  await expect(valid).toHaveCount(0);
  await input.fill(base64Key);
  await expect(valid).toBeVisible();
  await input.fill(secret);
  await expect(unverified).toBeVisible();
  await format.getByRole('button', { name: 'テキスト（UTF-8）', exact: true }).click();
  await expect(valid).toBeVisible();
  await input.fill('');
  await expect(unverified).toBeVisible();
  await expect(valid).toHaveCount(0);
  /** 公開鍵の空白だけの入力は、形式エラーへ変えずに未入力として扱う。 */
  await page.getByLabel('トークン', { exact: true }).fill(TOKENS.RS256);
  await page.getByLabel('公開鍵', { exact: true }).fill(secret);
  await expect(unverified).toBeVisible();
  await expect(page.getByText('公開鍵を読み込めません', { exact: false })).toHaveCount(0);
});

test('JWT：秘密鍵で署名を検証し、トークンと鍵は保存しない', async ({ page }) => {
  await page.goto('./#/jwt');
  await page.getByLabel('トークン').fill(TOKENS.HS256);
  await expect(page.getByText('署名は未検証')).toBeVisible();
  await page.getByLabel('秘密鍵', { exact: true }).fill('wrong-secret');
  await expect(page.getByRole('status')).toContainText('✗ 署名が一致しません');
  await page.getByLabel('秘密鍵', { exact: true }).fill(SECRET);
  await expect(page.getByRole('status')).toContainText('✓ 署名は正しく、この秘密鍵で作られています');
  await expect(page.getByText('署名は正しい', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
  expect(stored).not.toContain(SECRET);
  expect(stored).not.toContain(TOKENS.HS256.slice(0, 40));
});

test('JWT：時間がたつと、期限切れの表示に変わる', async ({ page }) => {
  /**
   * 時計は止まらずに進むため、読み込みや入力に時間がかかると「1分後」が「59秒後」になる。
   * 前後のどちらかだけを確かめる
   */
  await page.clock.install({ time: new Date('2023-11-14T22:13:20Z') });
  await page.goto('./#/jwt');
  /** exp は 1700000060（時計を合わせた時刻の1分後） */
  const payload = base64Url('{"sub":"1","exp":1700000060}');
  await page.getByLabel('トークン').fill(`eyJhbGciOiJIUzI1NiJ9.${payload}.c2ln`);
  await expect(page.getByText('有効期限内', { exact: true })).toBeVisible();
  await expect(page.getByText(/^JST（.+後）$/)).toBeVisible();
  await page.clock.fastForward('02:00');
  await expect(page.getByText('期限切れ', { exact: true })).toBeVisible();
  await expect(page.getByText(/^JST（.+前）$/)).toBeVisible();
});
