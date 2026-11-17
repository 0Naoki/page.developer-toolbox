/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 証明書：チェーンと署名の検証、秘密鍵の非保存、期限の更新。SAN を大量に含む証明書で、SAN・拡張・拡張の値を先頭100件だけ描画し、全件をコピーできること。SAN が少数でも長い値は「以降省略」と元の長さを示し、
 *   全文をコピーできること（短い値には何も付けない）。発行者の CN が長くても、署名の検証に使った鍵の説明と日時のエラーには抜粋だけを入れること。
 *   チェーンの診断の「n 枚目」を、読めないブロックや CSR が間にあってもカードの番号とそろえ、読めないブロックがあれば「正しい順番」と言わないこと。
 *   壊れた同じ拡張が大量に並んでも解析で画面を止めず、重複した拡張で SAN などを上書きしないこと（あわせて `src/tools/cert/logic.test.ts`）
 * - 証明書の開始・終了日時 × GeneralizedTime の小数秒・小数分：小数部を黙って切り捨てずに拒否する。通常の秒単位の日時は保ち、画面でエラーを表示した後も修正して解析を再開できる（あわせて `src/tools/cert/logic.test.ts`）
 */
import { expect, test } from './fixtures';
import { type Page } from '@playwright/test';
import { CROSS_BROWSER } from './tags';
import { LEAF, ROLLOVER_NEW_CA, ROLLOVER_OLD_CA, ROOT_CA } from '../src/tools/cert/certificates.fixtures';
import { TOKENS } from '../src/tools/jwt-decoder/tokens.fixtures';
import { certificateWithTime } from '../src/tools/cert/time.fixtures';
import { settleRendering, openNavigation } from './app';
import { pasteLargeInput } from './paste';
import { pickFile } from './files';
import { captureClipboard, copiedLength, copiedLines } from './clipboard';

/** 証明書デコーダーの E2E（ファイル読み込みの競合・上限、署名の検証とチェーン、期限の表示、SAN・拡張の表示の上限） */

test('証明書：小数部のある有効期間を拒否し、修正した日時で解析を再開する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/cert');
  const input = page.getByLabel('証明書または CSR（PEM）');
  for (const field of ['notBefore', 'notAfter'] as const) {
    await input.fill(certificateWithTime(field, '20500101000000.5Z'));
    await expect(page.getByRole('heading', { name: '読めません', exact: true })).toBeVisible();
    await expect(page.locator('.cert-card')).toContainText('証明書の日時に小数部は使えません');
    await expect(page.locator('.cert-card table')).toHaveCount(0);
  }
  await input.fill(certificateWithTime('notBefore', '20500101000000Z'));
  await expect(page.getByRole('heading', { name: '証明書', exact: true })).toBeVisible();
  await expect(page.locator('.cert-card')).toContainText('2050-01-01 09:00:00');
  await expect(page.locator('.cert-card .error-text')).toHaveCount(0);
});

for (const action of ['select', 'edit', 'navigate', 'error'] as const) {
  test(`証明書読込の競合：${action}操作後に古い結果を反映しない`, CROSS_BROWSER, async ({ page }) => {
    await page.goto('./#/cert');
    await page.locator('input[type=file]').evaluate((picker: HTMLInputElement, pem) => {
      const file = new File([pem], 'old.pem');
      file.arrayBuffer = () => new Promise((resolve, reject) => {
        (window as unknown as { finishCertRead: (fail: boolean) => void }).finishCertRead = (fail) => {
          if (fail) reject(new Error('古い読込エラー'));
          else resolve(new TextEncoder().encode(pem).buffer);
        };
      });
      const transfer = new DataTransfer(); transfer.items.add(file);
      picker.files = transfer.files; picker.dispatchEvent(new Event('change', { bubbles: true }));
    }, ROOT_CA);
    const input = page.getByLabel('証明書または CSR（PEM）');
    if (action === 'select') {
      await pickFile(page, 'latest.pem', LEAF);
      await expect(page.locator('.dropzone strong')).toHaveText('latest.pem');
    } else if (action === 'navigate') {
      await openNavigation(page);
      await page.getByRole('link', { name: 'JSON整形', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'JSON整形', exact: true })).toBeVisible();
    } else await input.fill(LEAF);
    await page.evaluate((fail) => (window as unknown as { finishCertRead: (fail: boolean) => void }).finishCertRead(fail), action === 'error');
    await settleRendering(page);
    if (action === 'select') await expect(page.locator('.dropzone strong')).toHaveText('latest.pem');
    else if (action === 'navigate') {
      await openNavigation(page);
      await page.getByRole('link', { name: '証明書デコーダー', exact: true }).click();
      await expect(input).toHaveValue('');
      await expect(page.locator('.cert-card')).toHaveCount(0);
    } else await expect(input).toHaveValue(LEAF);
    await expect(page.getByText('古い読込エラー', { exact: true })).toHaveCount(0);
  });
}

test('証明書：チェーンを解析し、フィンガープリントと署名の検証（Web Crypto API）の結果を表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/cert');
  await page.getByLabel('証明書または CSR（PEM）').fill(`${LEAF}\n${ROOT_CA}`);
  await expect(page.getByText('2 枚の証明書は、正しい順番でつながっています。')).toBeVisible();
  await expect(page.locator('.cert-card').first()).toContainText('*.example.test');
  await expect(page.locator('.cert-card').first()).toContainText('F6:46:5D:CE:C6:0F:BE:FB');
  /** 署名の検証（Web Crypto API）：サーバー証明書はルート CA の鍵で、ルート CA は自分の鍵で */
  await expect(page.locator('.cert-card').nth(0)).toContainText('✓ 正しい');
  await expect(page.locator('.cert-card').nth(1)).toContainText('✓ 正しい');
  await expect(page.locator('.notice.good', { hasText: '最後の証明書は自己署名のルート証明書です（自分の公開鍵で署名を確認しました' })).toBeVisible();
});

test('証明書：大量の不正PEMはエラーの表示数と読込み件数を制限する', async ({ page }) => {
  await page.goto('./#/cert');
  const block = '-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n';
  const input = page.getByRole('textbox', { name: '証明書または CSR（PEM）' });
  await input.fill(block.repeat(12) + LEAF);
  await expect(page.getByRole('heading', { name: /読めません/ })).toHaveCount(5);
  await expect(page.getByText('読み取れないブロックは全 12 件です（先頭 5 件を表示）。')).toBeVisible();
  await expect(page.getByRole('heading', { name: '13 枚目：証明書' })).toBeVisible();
  await input.fill(block.repeat(65));
  await expect(page.getByText('PEM は 64 ブロックまで読み込めます。入力を分割してください。')).toBeVisible();
  await expect(page.locator('.cert-card')).toHaveCount(0);
});

test('証明書：ルート証明書の署名が壊れていれば、自己署名のルート証明書と断定しない', async ({ page }) => {
  await page.goto('./#/cert');
  /** 署名の部分（PEM の最後から2行目）の1文字を変える */
  const lines = ROOT_CA.split('\n');
  const target = lines.length - 3;
  const line = lines[target]!;
  lines[target] = line.slice(0, 10) + (line[10] === 'A' ? 'B' : 'A') + line.slice(11);
  await page.getByLabel('証明書または CSR（PEM）').fill(`${LEAF}\n${lines.join('\n')}`);
  await expect(page.locator('.cert-card').nth(0)).toContainText('✓ 正しい');
  await expect(page.locator('.cert-card').nth(1)).toContainText('一致しません');
  await expect(page.locator('.notice.bad', { hasText: '最後の証明書は発行者名とサブジェクトが一致しますが、自分の公開鍵で署名を確認できません' })).toBeVisible();
  await expect(page.getByText('最後の証明書は自己署名のルート証明書です', { exact: false })).toHaveCount(0);
  await expect(page.locator('.cert-card').nth(1).getByText('自己発行（署名が一致しない）')).toBeVisible();
});

test('証明書：上限を超えるファイルを選ぶと、前に読み込んだファイルの結果を消す', async ({ page }) => {
  await page.goto('./#/cert');
  const pick = (contents: string | number, name: string) => pickFile(page, name, typeof contents === 'number' ? { zeros: contents } : contents);
  await pick(ROOT_CA, 'root.pem');
  await expect(page.locator('.dropzone strong')).toHaveText('root.pem');
  await expect(page.locator('.cert-card').first()).toContainText('✓ 正しい');
  await pick(2 * 1024 * 1024, 'large.pem');
  await expect(page.getByText('ファイルが大きすぎます', { exact: false })).toBeVisible();
  await expect(page.locator('.cert-card')).toHaveCount(0);
  await expect(page.getByText('✓ 正しい', { exact: false })).toHaveCount(0);
  await expect(page.locator('.dropzone strong')).toHaveText('ファイルをドロップ、またはクリックして選択');
});

test('証明書：PEM を貼り付けた後に上限を超えるファイルを選ぶと、貼り付けた入力と結果を消す', async ({ page }) => {
  await page.goto('./#/cert');
  const input = page.getByLabel('証明書または CSR（PEM）');
  await input.fill(ROOT_CA);
  await expect(page.locator('.cert-card').first()).toContainText('✓ 正しい');
  await pickFile(page, 'large.pem', { zeros: 2 * 1024 * 1024 });
  await expect(page.getByText('ファイルが大きすぎます', { exact: false })).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.locator('.cert-card')).toHaveCount(0);
  await expect(page.getByText('✓ 正しい', { exact: false })).toHaveCount(0);
});

test('証明書：秘密鍵を貼り付けると解析せずに警告し、どこにも保存しない', async ({ page }) => {
  await page.goto('./#/cert');
  await page.getByLabel('証明書または CSR（PEM）').fill('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----');
  await expect(page.getByText('秘密鍵が含まれています。')).toBeVisible();
  await expect(page.locator('.cert-card')).toHaveCount(0);
  await settleRendering(page);
  const stored = await page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((s) => Object.keys(s).filter((k) => (s.getItem(k) ?? '').includes('PRIVATE'))),
  );
  expect(stored).toEqual([]);
});

test('JWT：公開鍵（証明書）で ES256 の署名を検証する。JWE はヘッダだけを表示する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/jwt');
  await page.getByLabel('トークン').fill(TOKENS.ES256);
  await page.getByLabel('公開鍵', { exact: true }).fill(LEAF);
  await expect(page.getByRole('status')).toContainText('✓ 署名は正しく、この公開鍵と対になる秘密鍵で署名されています（証明書「www.example.test」の公開鍵）');
  /** 秘密鍵は読まない */
  await page.getByLabel('公開鍵', { exact: true }).fill('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----');
  await expect(page.getByText('秘密鍵が含まれています', { exact: false })).toBeVisible();

  await page.getByLabel('トークン').fill('eyJhbGciOiJSU0EtT0FFUCIsImVuYyI6IkEyNTZHQ00ifQ.a.b.c.d');
  await expect(page.getByText('JWE（暗号化されたトークン）です', { exact: false })).toBeVisible();
  await expect(page.locator('pre')).toContainText('"enc": "A256GCM"');
});

test('証明書：表示したまま期限を過ぎると、期限切れの表示に変わる', async ({ page }) => {
  /** LEAF の期限（notAfter）は 2027-12-02T15:59:10Z。その1分前に表示する */
  await page.clock.install({ time: new Date('2027-12-02T15:58:10Z') });
  await page.goto('./#/cert');
  await page.getByLabel('証明書または CSR（PEM）').fill(LEAF);
  await expect(page.getByText('あと 0 日で期限切れ', { exact: true })).toBeVisible();
  await page.clock.fastForward('02:00');
  await expect(page.getByText('期限切れ（本日）', { exact: true })).toBeVisible();
});

test('証明書：自己発行の鍵の更新は、旧い CA の鍵で検証し、自己署名とは表示しない', async ({ page }) => {
  await page.goto('./#/cert');
  await page.getByLabel('証明書または CSR（PEM）').fill(`${ROLLOVER_NEW_CA}\n${ROLLOVER_OLD_CA}`);
  const [newCard, oldCard] = [page.locator('.cert-card').nth(0), page.locator('.cert-card').nth(1)];
  await expect(newCard).toContainText('✓ 正しい');
  await expect(newCard).toContainText('自己発行。自分の鍵ではなく、この CA の鍵で署名');
  await expect(newCard.getByText('自己発行（別の鍵で署名）', { exact: true })).toBeVisible();
  /** 旧い CA は自分の鍵で確認できる自己署名の証明書 */
  await expect(oldCard.getByText('自己署名', { exact: true })).toBeVisible();
  await expect(page.locator('.notice.good', { hasText: '最後の証明書は自己署名のルート証明書です' })).toBeVisible();

  /** 新しい CA を最後に置くと、ルート証明書とは表示しない */
  await page.getByLabel('証明書または CSR（PEM）').fill(`${ROLLOVER_OLD_CA}\n${ROLLOVER_NEW_CA}`);
  await expect(page.getByText('自己署名のルート証明書ではありません', { exact: false })).toBeVisible();
});

/**
 * SAN を count 件と、ほかの拡張を extra 個含む証明書の PEM をブラウザ内で作る（署名は検証に通らない値。表示の検査用）。
 * サブジェクトと発行者の CN を省くと、名前が同じ自己発行の証明書にする
 */
const certWithManySans = (page: Page, count: number, longValue: string, extra = 0, subject = 'many-san.example', issuer = subject) => page.evaluate(async ([count, longValue, extra, subject, issuer]) => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const length = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
  const join = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const tlv = (tag: number, ...parts: Uint8Array[]) => { const body = join(parts); return join([Uint8Array.from([tag, ...length(body.length)]), body]); };
  const bytes = (...values: number[]) => Uint8Array.from(values);
  const text = (value: string) => new TextEncoder().encode(value);
  const name = (cn: string) => tlv(0x30, tlv(0x31, tlv(0x30, bytes(0x06, 0x03, 0x55, 0x04, 0x03), tlv(0x0c, text(cn)))));
  const names = Array.from({ length: count }, (_, i) => tlv(0x82, text(i === 0 ? longValue : `host${i}.example.com`)));
  const san = tlv(0x30, bytes(0x06, 0x03, 0x55, 0x1d, 0x11), tlv(0x04, tlv(0x30, ...names)));
  /** OID 1.2.3.4.n の、意味を持たない拡張（値は空の OCTET STRING） */
  const others = Array.from({ length: extra }, (_, n) => tlv(0x30, tlv(0x06, bytes(0x2a, 0x03, 0x04, ...(n < 128 ? [n] : [0x80 | (n >> 7), n & 0x7f]))), tlv(0x04, tlv(0x04))));
  const ecdsaSha256 = tlv(0x30, bytes(0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02));
  const tbs = tlv(0x30, tlv(0xa0, bytes(0x02, 0x01, 0x02)), bytes(0x02, 0x01, 0x01), ecdsaSha256, name(issuer),
    tlv(0x30, tlv(0x17, text('260101000000Z')), tlv(0x17, text('360101000000Z'))), name(subject), spki, tlv(0xa3, tlv(0x30, san, ...others)));
  const der = tlv(0x30, tbs, ecdsaSha256, tlv(0x03, bytes(0x00, 0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01)));
  let binary = '';
  for (const b of der) binary += String.fromCharCode(b);
  return `-----BEGIN CERTIFICATE-----\n${btoa(binary).replace(/.{64}/g, '$&\n')}\n-----END CERTIFICATE-----`;
}, [count, longValue, extra, subject, issuer] as const);

test('証明書：大量の SAN と長い値は、先頭だけを描画し、全件はコピーで取り出せる', async ({ page }) => {
  await page.goto('./#/cert');
  await captureClipboard(page);
  await page.getByLabel('証明書または CSR（PEM）').fill(await certWithManySans(page, 1_200, `${'a'.repeat(5_000)}.example.com`));
  const card = page.locator('.cert-card').first();
  await expect(card.locator('.san-list li')).toHaveCount(100);
  /** SAN の行と、閉じた「すべての拡張」の中の SAN の値のどちらも、残りの件数だけを示す */
  await expect(card.getByText('ほか 1,100 件（先頭 100 件を表示）')).toHaveCount(2);
  await expect(card.locator('.cert-table td div:not(.muted)')).toHaveCount(100);
  /** 長い値は先頭の2,000単位までを表示する */
  const first = await card.locator('.san-list li').first().textContent();
  expect(first?.length).toBeLessThan(2_100);
  await card.getByRole('button', { name: 'すべての SAN をコピー', exact: true }).click();
  await expect.poll(() => copiedLines(page)).toBe(1200);
});

test('証明書：拡張の個数も先頭だけを描画し、全件はコピーで取り出せる', async ({ page }) => {
  await page.goto('./#/cert');
  await page.getByLabel('証明書または CSR（PEM）').fill(await certWithManySans(page, 1, 'a.example.com', 150));
  const card = page.locator('.cert-card').first();
  /** SAN と、意味を持たない拡張150個の計151個のうち、先頭100個だけを描画する */
  await card.locator('summary', { hasText: 'すべての拡張（151）' }).click();
  await expect(card.locator('details .cert-table > tbody > tr')).toHaveCount(100);
  await expect(card.getByText('ほか 51 件（先頭 100 件を表示）')).toBeVisible();
  await expect(card.getByRole('button', { name: 'すべての拡張をコピー', exact: true })).toBeVisible();
});

test('証明書：件数が少なくても長い値は、省略を示して全文をコピーでき、短い値には何も付けない', async ({ page }) => {
  await page.goto('./#/cert');
  await captureClipboard(page);
  const long = `${'a'.repeat(3_000)}.example.com`;
  /** SAN は3件（少数）で、先頭の1件だけが長い */
  await page.getByLabel('証明書または CSR（PEM）').fill(await certWithManySans(page, 3, long));
  const card = page.locator('.cert-card').first();
  const first = card.locator('.san-list li').first();
  await expect(first).toContainText(`（以降省略。全${long.length.toLocaleString('ja-JP')}文字）`);
  /** 件数は上限以内なので、残りの件数は出さない */
  await expect(card.getByText('件（先頭', { exact: false })).toHaveCount(0);
  /** 短い値には、省略の印もコピーボタンも付けない */
  await expect(card.locator('.san-list li').nth(1)).toHaveText('DNS host1.example.com');
  await first.getByRole('button', { name: '全文をコピー', exact: true }).click();
  await expect.poll(() => copiedLength(page)).toBe(long.length);
  /** 閉じた「すべての拡張」の中の SAN の値（「DNS: …」）も、同じく省略を示して全文をコピーできる */
  await card.locator('summary', { hasText: 'すべての拡張' }).click();
  await card.locator('details').getByRole('button', { name: '全文をコピー', exact: true }).click();
  await expect.poll(() => copiedLength(page)).toBe('DNS: '.length + long.length);
});

test('証明書：発行者の CN が長くても、署名の検証に使った鍵の説明には抜粋だけを入れる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/cert');
  const long = 'C'.repeat(100_000);
  const leaf = await certWithManySans(page, 1, 'leaf.example', 0, 'leaf.example', long);
  const issuer = await certWithManySans(page, 1, 'ca.example', 0, long, 'root.example');
  await pasteLargeInput(page, '証明書または CSR（PEM）', `${leaf}\n${issuer}`);
  const by = page.locator('.cert-card').first().locator('.muted').filter({ hasText: 'で検証' });
  await expect(by).toHaveText(`発行者「${'C'.repeat(255)}…」の公開鍵で検証`);
});
