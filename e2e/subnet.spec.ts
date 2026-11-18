/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - サブネット：集約10万件の表示上限と全文コピー、VLSMの表示上限と入力順の全文コピー、CR・LF・CRLF混在の一覧の重複と行番号、壊れた分割設定からの復旧。IPv6 のグループや VLSM の名前が長くても、
 *   エラーの文言を抜粋にして、末尾の理由を表示の上限で切らないこと。IPv6 の範囲の区切りの記号が多く並んだ長い行でも、入力長の2乗の時間をかけないこと（あわせて `src/tools/subnet/ipv4.test.ts`・`src/tools/subnet/ipv6.test.ts`）
 *   均等分割は表示が1,024件でもIPv4・IPv6の全件をコピー・保存でき、入力変更や出力上限超過で古い全文を使わないこと。ゾーンID付きIPv6の不正なプレフィックスも拒否すること。包含判定でも接尾辞を読み飛ばさず、修正すれば正常な判定に戻ること
 *   ゾーンIDに -・~ があるIPv6は、単独アドレス・CIDR・範囲・集約で同じように扱うこと。
 * - クラウドの予約数 × IPv4・IPv6 × AWS・Azure のサイズ条件：5アドレスの計算とサービスごとの案内を分け、範囲の両端と刻みの対象外を検証する（あわせて `src/tools/subnet/cloudPolicy.test.ts`・`src/tools/subnet/ipv6.test.ts`）
 */
import { expect, test } from './fixtures';
import { type Page } from '@playwright/test';
import { pasteLargeInput } from './paste';
import { captureClipboard, copiedText, copiedLines, copiedLength } from './clipboard';
import { CROSS_BROWSER } from './tags';
import { downloadedText } from './files';


/** 計算結果の表で、見出しが label の行 */
const row = (page: Page, label: string) => page.locator('tr', { has: page.locator('th', { hasText: new RegExp(`^${label}$`) }) });
const selectTab = (page: Page, name: string) => page.getByRole('group', { name: '機能' }).getByRole('button', { name, exact: true }).click();

test('サブネット：ゾーンIDの記号を単独アドレス・CIDR・範囲で同じように扱う', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/subnet');
  const address = page.getByLabel('アドレスとプレフィックス長、またはマスク', { exact: true });
  await address.fill('fe80::1%eth0-1/64');
  await expect(row(page, 'プレフィックス')).toContainText('fe80::/64');
  await selectTab(page, '集約・範囲変換');
  const input = page.getByLabel('CIDR・アドレスの範囲・アドレスの一覧（1行に1つ）');
  await input.fill('fe80::1%eth0-1\nfe80::2%eth0~1');
  await expect(page.getByLabel('集約結果')).toHaveText('fe80::1/128\nfe80::2/128');
  await input.fill('fe80::1%eth0-1 - fe80::2%eth0~1');
  await expect(page.getByLabel('集約結果')).toHaveText('fe80::1/128\nfe80::2/128');
});

test('サブネット：包含判定でもゾーンIDの後の不正な接尾辞を拒否する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/subnet');
  await page.getByLabel('アドレスとプレフィックス長、またはマスク', { exact: true }).fill('fe80::/64');
  const check = page.getByLabel('判定するアドレス', { exact: true });
  for (const input of ['fe80::1%eth0/129', 'fe80::1%eth0/64x']) {
    await check.fill(input);
    await expect(page.getByText('fe80::/64 に含まれます', { exact: true })).toHaveCount(0);
    await expect(page.getByText('アドレスだけを指定してください', { exact: false })).toBeVisible();
  }
  await check.fill('fe80::1%eth0');
  await expect(page.getByText('fe80::/64 に含まれます', { exact: true })).toBeVisible();
});

for (const [input, prefix, count, last] of [
  ['10.0.0.0/16', '28', 4096, '10.0.255.240/28'],
  ['2001:db8::/48', '64', 65536, '2001:db8:0:ffff::/64'],
] as const) {
  test(`サブネット：${input} の均等分割を全件コピー・保存する`, CROSS_BROWSER, async ({ page }) => {
    await captureClipboard(page);
    await page.goto('./#/subnet');
    await selectTab(page, '分割');
    await page.getByRole('textbox', { name: '分割するネットワーク', exact: true }).fill(input);
    await page.getByLabel('分割後').selectOption(prefix);
    await expect(page.locator('.data-table tbody tr')).toHaveCount(1024);
    const copy = page.getByRole('button', { name: '全件をコピー', exact: true });
    await expect(copy).toBeEnabled();
    await copy.click();
    await expect.poll(() => copiedLines(page)).toBe(count);
    await page.getByRole('button', { name: '先頭1,024件をコピー', exact: true }).click();
    await expect.poll(() => copiedLines(page)).toBe(1024);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '全件を保存', exact: true }).click();
    const saved = await downloadedText(await download);
    expect(saved.split('\n')).toHaveLength(count);
    expect(saved.split('\n').at(-1)).toBe(last);
    await page.getByRole('textbox', { name: '分割するネットワーク', exact: true }).fill('::/0');
    await page.getByLabel('分割後').selectOption('128');
    await expect(page.getByText(/分割結果の全件出力は100,000件まで/)).toBeVisible();
    await expect(copy).toBeDisabled();
    await expect(page.getByRole('button', { name: '全件を保存', exact: true })).toBeDisabled();
  });
}

test('サブネット：ゾーンID付きIPv6の不正なプレフィックスを拒否する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/subnet');
  await page.getByLabel('アドレスとプレフィックス長、またはマスク', { exact: true }).fill('fe80::1%eth0/64x');
  await expect(page.getByText('IPv6 のプレフィックス長は / の後に 0〜128 の整数で指定してください', { exact: true })).toBeVisible();
  await expect(row(page, 'プレフィックス')).toHaveCount(0);
});

test('サブネット：クラウドの予約数とサービスごとのIPv6サイズを案内する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/subnet');
  await page.getByLabel('アドレスとプレフィックス長、またはマスク', { exact: true }).fill('2001:db8::/60');
  await page.getByLabel('AWS・Azure の予約（5アドレス）を除く', { exact: true }).check();
  await expect(page.getByText('AWS の IPv6 サブネットは /44〜/64（4刻み） です', { exact: true })).toBeVisible();
  await expect(page.getByText('Azure の IPv6 サブネットは /64 です（/60 は対象外）', { exact: true })).toBeVisible();
});

test('サブネット：単独CRを含む大容量一覧でもIPv4とIPv6の重複を検出する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/subnet');
  await selectTab(page, '重複チェック');
  const source = '10.0.0.0/24\r10.0.0.0/25\r\n2001:db8::/48\n2001:db8::/56\r#' + 'x'.repeat(51_000);
  await pasteLargeInput(page, 'CIDR の一覧（1行に1つ。後ろに名前を書けます）', source);
  await expect(page.getByText('2件の重なりがあります。', { exact: true })).toBeVisible();
  await expect(page.locator('.overlap-list li')).toHaveText([
    '10.0.0.0/24［1行目］ は 10.0.0.0/25［2行目］ を含みます',
    '2001:db8::/48［3行目］ は 2001:db8::/56［4行目］ を含みます',
  ]);
  expect(await page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:subnet:list'))).toBe(source);
});

test('サブネット：IPv4 の計算と、アドレスが含まれるかの判定', async ({ page }) => {
  await page.goto('./#/subnet');
  const input = page.getByRole('textbox', { name: 'アドレスとプレフィックス長、またはマスク', exact: true });

  await input.fill('192.168.1.130/26');
  await expect(page.getByText('192.168.1.130 はこのサブネットのホストのアドレスです。ネットワークは 192.168.1.128/26 です。')).toBeVisible();
  await expect(row(page, 'ネットワーク').first()).toContainText('192.168.1.128');
  await expect(row(page, 'ブロードキャスト')).toContainText('192.168.1.191');
  await expect(row(page, '利用できる範囲')).toContainText('192.168.1.129 〜 192.168.1.190');
  await expect(row(page, 'ホスト数')).toContainText('62（全体 64 アドレス）');
  await expect(row(page, 'サブネットマスク')).toContainText('255.255.255.192');
  await expect(row(page, 'ワイルドカード')).toContainText('0.0.0.63');

  const check = page.getByRole('textbox', { name: '判定するアドレス', exact: true });
  await check.fill('192.168.1.191');
  await expect(page.getByText('192.168.1.128/26 に含まれます')).toBeVisible();
  await check.fill('192.168.1.192');
  await expect(page.getByText('192.168.1.128/26 に含まれません')).toBeVisible();

  /** サブネットマスクでの入力と、クラウドの予約アドレス */
  await input.fill('10.0.0.5 255.255.255.0');
  await expect(row(page, 'CIDR')).toContainText('10.0.0.0/24');
  await expect(row(page, 'ホスト数')).toContainText('254（全体 256 アドレス）');
  await page.getByRole('checkbox', { name: 'AWS・Azure の予約（5アドレス）を除く' }).check();
  await expect(row(page, 'ホスト数')).toContainText('251（全体 256 アドレス）');

  await input.fill('10.0.0.256/24');
  await expect(page.locator('.error-text')).toBeVisible();
  await expect(row(page, 'CIDR')).toHaveCount(0);
});

test('サブネット：IPv6 の計算は、RFC 5952 の省略表記と省略しない表記を出す', async ({ page }) => {
  await page.goto('./#/subnet');
  await page.getByRole('textbox', { name: 'アドレスとプレフィックス長、またはマスク', exact: true }).fill('2001:DB8:0:0:0:0:0:1/64');
  await expect(row(page, 'プレフィックス')).toContainText('2001:db8::/64');
  await expect(row(page, '先頭')).toContainText('2001:db8::');
  await expect(row(page, '末尾')).toContainText('2001:db8::ffff:ffff:ffff:ffff');
  await expect(row(page, '省略しない表記')).toContainText('2001:0db8:0000:0000:0000:0000:0000:0001');

  const check = page.getByRole('textbox', { name: '判定するアドレス', exact: true });
  await check.fill('2001:db8::abcd');
  await expect(page.getByText('2001:db8::/64 に含まれます')).toBeVisible();
  await check.fill('2001:db8:0:1::1');
  await expect(page.getByText('2001:db8::/64 に含まれません')).toBeVisible();
});

test('サブネット：重複チェックは、含む範囲と同じ範囲を行番号つきで伝える', async ({ page }) => {
  await page.goto('./#/subnet');
  await selectTab(page, '重複チェック');
  const list = page.getByRole('textbox', { name: 'CIDR の一覧（1行に1つ。後ろに名前を書けます）', exact: true });

  await list.fill('10.0.0.0/16 本番VPC\n10.1.0.0/16 検証VPC  # コメント\n2001:db8::/56');
  await expect(page.getByText('3 件の範囲に、重なりはありません。')).toBeVisible();

  await list.fill('10.0.0.0/16 本番VPC\n10.0.128.0/20 拠点A\n10.1.0.0/16\n10.1.0.0/16 複製\n2001:db8::/48\n2001:db8::/56 本番（IPv6）');
  await expect(page.getByText('3件の重なりがあります。')).toBeVisible();
  const items = page.locator('.overlap-list li');
  await expect(items).toHaveText([
    '10.0.0.0/16（本番VPC）［1行目］ は 10.0.128.0/20（拠点A）［2行目］ を含みます',
    '10.1.0.0/16［3行目］ と 10.1.0.0/16（複製）［4行目］ は同じ範囲です',
    '2001:db8::/48［5行目］ は 2001:db8::/56（本番（IPv6））［6行目］ を含みます',
  ]);
});

test('サブネット：同じ大きさに分割し、IPv6 も分割できる', async ({ page }) => {
  await page.goto('./#/subnet');
  await selectTab(page, '分割');
  const input = page.getByRole('textbox', { name: '分割するネットワーク', exact: true });

  await input.fill('10.0.0.0/24');
  await page.getByLabel('分割後').selectOption('26');
  await expect(page.getByText('4 個のサブネット', { exact: true })).toBeVisible();
  await expect(page.getByText('1つあたり 62 ホスト', { exact: true })).toBeVisible();
  const rows = page.locator('.data-table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText('10.0.0.192/26');
  await expect(rows.nth(3)).toContainText('10.0.0.193 〜 10.0.0.254');

  /** ネットワークアドレスでない入力は、ネットワークに直して分割する */
  await input.fill('10.0.0.77/24');
  await expect(page.getByText('ネットワーク 10.0.0.0/24 として分割します。')).toBeVisible();

  await input.fill('2001:db8::/48');
  await page.getByLabel('分割後').selectOption('50');
  await expect(page.getByText('4 個のサブネット', { exact: true })).toBeVisible();
  /** /48 の次の2ビット（4つ目のグループの先頭）で分ける */
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toContainText('2001:db8:0:c000::/50');
});

test('サブネット：VLSM は大きい順に割り当て、不正なホスト数と収まらない要求を伝える', async ({ page }) => {
  await page.goto('./#/subnet');
  await selectTab(page, '分割');
  await page.getByRole('textbox', { name: '分割するネットワーク', exact: true }).fill('10.0.0.0/24');
  await page.getByRole('button', { name: '必要なホスト数で割り当て（VLSM）', exact: true }).click();
  const requests = page.getByRole('textbox', { name: 'サブネットの名前と必要なホスト数（1行に1つ）', exact: true });

  await requests.fill('サーバー 20\n営業部 120\n開発部 60\n負の数 -5\n桁区切り 1,500');
  const rows = page.locator('.data-table tbody tr');
  /** 表は入力の順。割り当ては大きい順に先頭から詰める */
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('サーバー（20）');
  await expect(rows.nth(0)).toContainText('10.0.0.192/27');
  await expect(rows.nth(1)).toContainText('営業部（120）');
  await expect(rows.nth(1)).toContainText('10.0.0.0/25');
  await expect(rows.nth(2)).toContainText('開発部（60）');
  await expect(rows.nth(2)).toContainText('10.0.0.128/26');
  await expect(page.getByText('4行目：「営業部 120」のように')).toBeVisible();
  await expect(page.getByText('5行目：「営業部 120」のように')).toBeVisible();

  await requests.fill('大きい 200\n小さい 100');
  await expect(page.getByText('10.0.0.0/24 に収まりません（「小さい」の /25 を割り当てられません）')).toBeVisible();
  await expect(rows).toHaveCount(0);
});

test('サブネット：VLSMは先頭だけを表示し、コピーは入力順の全件を使う', async ({ page }) => {
  await captureClipboard(page);
  await page.goto('./#/subnet');
  await selectTab(page, '分割');
  await page.getByRole('textbox', { name: '分割するネットワーク', exact: true }).fill('10.0.0.0/16');
  await page.getByRole('button', { name: '必要なホスト数で割り当て（VLSM）', exact: true }).click();
  await page.getByRole('textbox', { name: 'サブネットの名前と必要なホスト数（1行に1つ）', exact: true })
    .fill('小 2\n大 120\n' + '中 2\n'.repeat(1023) + '不正\n'.repeat(21));
  await expect(page.locator('.data-table tbody tr')).toHaveCount(1024);
  await expect(page.getByText('ほか 1 行にエラーがあります')).toBeVisible();
  await page.getByRole('button', { name: '一覧をコピー' }).click();
  await expect.poll(() => copiedLines(page)).toBe(1025);
  const copied = (await copiedText(page))?.split('\n');
  expect(copied).toHaveLength(1025);
  expect(copied?.slice(0, 2)).toEqual(['10.0.0.128/30 小', '10.0.0.0/25 大']);
  expect(copied?.at(-1)).toBe('10.0.16.124/30 中');
});

test('サブネット：集約は重なりと隣り合う範囲をまとめ、範囲を CIDR に変換する', async ({ page }) => {
  await page.goto('./#/subnet');
  await selectTab(page, '集約・範囲変換');
  const list = page.getByRole('textbox', { name: 'CIDR・アドレスの範囲・アドレスの一覧（1行に1つ）', exact: true });

  await list.fill('10.0.0.0/25\n10.0.0.128/25\n10.0.0.64/26\n192.168.0.10 - 192.168.0.13\n172.16.5.1\n2001:db8::/33\n2001:db8:8000::/33');
  await expect(page.locator('pre.code')).toHaveText(['10.0.0.0/24\n172.16.5.1/32\n192.168.0.10/31\n192.168.0.12/31\n2001:db8::/32']);
  await expect(page.getByText('5 個の CIDR', { exact: true })).toBeVisible();
  await expect(page.getByText(/^IPv4 261・IPv6 /)).toBeVisible();

  await list.fill('10.0.0.0/24\n192.168.0.20 - 192.168.0.10\nabc');
  await expect(page.getByText('2行目：開始アドレスが終了アドレスより後ろにあります')).toBeVisible();
  await expect(page.locator('.error-text').filter({ hasText: /^3行目：/ })).toBeVisible();
  await expect(page.locator('pre.code')).toHaveText(['10.0.0.0/24']);
});


test('サブネット：壊れた分割設定は復旧し、表示と計算が一致する', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dev-toolbox:pref:subnet:newPrefix', '"abc"');
    localStorage.setItem('dev-toolbox:pref:subnet:newPrefix6', '"129"');
  });
  await page.goto('./#/subnet');
  await selectTab(page, '分割');
  const input = page.getByRole('textbox', { name: '分割するネットワーク', exact: true });
  const prefix = page.getByLabel('分割後');
  await expect(prefix).toHaveValue('24');
  await input.fill('10.0.0.0/26');
  await expect(prefix).toHaveValue('26');
  await expect(page.getByText('10.0.0.0/26', { exact: true })).toBeVisible();
  await input.fill('2001:db8::/62');
  await expect(prefix).toHaveValue('64');
  await expect(page.getByText('4 個のサブネット', { exact: true })).toBeVisible();
});

test('サブネット：集約の表示を制限し、コピーには10万件の全結果を使う', async ({ page }) => {
  await captureClipboard(page);
  await page.addInitScript(() => {
    const input = Array.from({ length: 100_000 }, (_, i) =>
      '10.' + (i >> 15) + '.' + ((i >> 7) & 255) + '.' + ((i & 127) * 2)).join('\n');
    sessionStorage.setItem('dev-toolbox:input:subnet:aggregate', input);
  });
  await page.goto('./#/subnet');
  await selectTab(page, '集約・範囲変換');
  await expect(page.getByText('100,000 個の CIDR', { exact: true })).toBeVisible();
  expect((await page.locator('pre.code').textContent())?.length).toBe(50_000);
  await page.getByRole('button', { name: '一覧をコピー' }).click();
  await expect.poll(() => copiedLength(page)).toBe(1_511_791);
});

test('サブネット：長い不正行はエラーの表示量も制限する', async ({ page }) => {
  await page.goto('./#/subnet');
  await selectTab(page, '集約・範囲変換');
  const list = page.getByRole('textbox', { name: 'CIDR・アドレスの範囲・アドレスの一覧（1行に1つ）', exact: true });
  await list.fill('x'.repeat(100_000));
  const message = page.locator('.error-text').filter({ hasText: /^1行目：/ });
  await expect(message).toContainText('…');
  expect((await message.textContent())?.length).toBeLessThan(300);
});

test('サブネット：重複チェックの警告は先頭20件だけ表示し、残りの件数を伝える', async ({ page }) => {
  await page.goto('./#/subnet');
  await page.getByRole('group', { name: '機能' }).getByRole('button', { name: '重複チェック' }).click();
  /** ネットワークアドレスでない CIDR（警告が出る）を300行（上限の20件を超えれば足りる。多いと入力に時間がかかる） */
  const lines = Array.from({ length: 300 }, (_, i) => `10.${i >> 8}.${i & 255}.1/24`).join('\n');
  await page.getByLabel('CIDR の一覧（1行に1つ。後ろに名前を書けます）').fill(lines);
  await expect(page.getByText('ほか 280 行も、ネットワークアドレスに直して扱いました')).toBeVisible();
  await expect(page.locator('.notice.warn')).toHaveCount(21);
});
