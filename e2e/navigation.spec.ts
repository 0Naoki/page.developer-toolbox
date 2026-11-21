/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R004] ナビゲーション：IME中のキー処理、フォーカス・スクロール、名前・選択状態の読み上げ
 */
/** 画面のファイルの読込失敗を試すケースは、失敗そのもの（abort した読み込みのエラー）を扱うため、標準の test（probeTest）で期待する状態をケース内で検証する。ほかは監視付きの test を使う。 */
import { test as probeTest } from '@playwright/test';
import { expect, test } from './fixtures';
import { CROSS_BROWSER } from './tags';
import { openPalette, TOOLS, settleRendering, openNavigation } from './app';

test('削除したSQL整形のURLや保存済みの履歴があっても、残りのツールを利用できる', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dev-toolbox:pref:favorites', JSON.stringify(['sql', 'json']));
    localStorage.setItem('dev-toolbox:pref:recent', JSON.stringify(['sql']));
    localStorage.setItem('dev-toolbox:setting:persistInputs', JSON.stringify(['sql', 'json']));
  });
  await page.goto('./#/sql');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ツールが見つかりません');
  await expect(page.getByRole('link', { name: 'SQL整形', exact: true })).toHaveCount(0);
  await (await openPalette(page)).fill('sql');
  await expect(page.getByRole('status')).toHaveText('該当するツールがありません');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'トップに戻る', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('開発者向けユーティリティ');
  await openNavigation(page);
  await page.getByRole('navigation').getByRole('link', { name: 'JSON整形', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('JSON整形');
});

probeTest('画面のファイルを読み込めなくても、アプリ全体は消えずに再読み込みを案内する', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('開発者向けユーティリティ');
  /** 新しい版の公開で古いファイルが消えた状態を再現する */
  await page.route('**/assets/**', (route) => route.abort());
  await page.evaluate(() => {
    location.hash = '#/json';
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('画面を表示できません');
  await expect(page.getByText('新しい版が公開されたため')).toBeVisible();
  await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible();
  await expect(page.locator('.sidebar')).toBeAttached();
});

test('ツール検索で、選択中の候補が読み上げソフトに伝わる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  const combobox = await openPalette(page);
  const options = page.getByRole('option');
  await expect(combobox).toHaveAttribute('aria-activedescendant', (await options.nth(0).getAttribute('id'))!);
  await page.keyboard.press('ArrowDown');
  await expect(combobox).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id'))!);
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('ツール検索で該当がないことが、常に置かれた status 要素で伝わる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  await openPalette(page);
  const status = page.getByRole('status');
  /** 該当なしになる前から置いておく（あとから作った要素は読み上げられないことが多いため） */
  await expect(status).toBeAttached();
  await expect(status).toHaveText('');
  await page.getByRole('combobox', { name: 'ツールを検索' }).fill('zzzz');
  await expect(status).toHaveText('該当するツールがありません');
  await expect(status).toBeVisible();
  /** 候補一覧の中には候補（option）以外を置かない */
  await expect(page.getByRole('listbox').locator(':scope > :not([role="option"])')).toHaveCount(0);
});

test('ツール検索：日本語入力（IME）の変換中の Enter や矢印キーではツールを開かない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  const combobox = await openPalette(page);
  /** 「日」で候補がある状態にしてから、変換中のキー入力（isComposing / keyCode 229）を送る */
  await combobox.fill('日');
  const firstId = await page.getByRole('option').first().getAttribute('id');
  await combobox.evaluate((input) => {
    for (const init of [
      { key: 'ArrowDown', isComposing: true },
      { key: 'Enter', isComposing: true },
      { key: 'Enter', keyCode: 229 }, // Safari は確定の Enter を変換終了後に keyCode 229 で送る
    ]) {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    }
  });
  /** トップページのまま（どのツールの URL「#/ツールID」にもなっていない） */
  await expect(combobox).toBeVisible();
  await expect(page).not.toHaveURL(/#\/\w/);
  await expect(combobox).toHaveAttribute('aria-activedescendant', firstId!);
  /** 変換を確定した後の Enter では開く */
  await combobox.press('Enter');
  await expect(page).toHaveURL(/#\/\w/);
});

test('ツール検索：矢印キーで選んだ候補が一覧の中に見えている', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  await openPalette(page);
  const options = page.getByRole('option');
  const count = await options.count();
  for (let i = 1; i < count; i++) await page.keyboard.press('ArrowDown');
  const visible = await page.locator('.palette-list').evaluate((list) => {
    const active = list.querySelector('[aria-selected="true"]')!;
    const l = list.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    return { scrolled: list.scrollTop > 0, inside: a.top >= l.top - 1 && a.bottom <= l.bottom + 1 };
  });
  expect(visible).toEqual({ scrolled: true, inside: true });
});

test('ツール検索：閉じると元の場所にフォーカスが戻り、開いている間は Tab で外へ出ない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  await openNavigation(page);
  const trigger = page.locator('.search-trigger');
  await trigger.click();
  const combobox = page.getByRole('combobox', { name: 'ツールを検索' });
  await expect(combobox).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(combobox).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(combobox).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(combobox).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('全ツールで、入力欄・ボタンなどに読み上げ用の名前が付いている', async ({ page }) => {
  const unnamed: Record<string, string[]> = {};
  for (const [id] of TOOLS) {
    await page.goto(`./#/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const snapshot = await page.locator('main').ariaSnapshot();
    /** 名前のある要素は「- textbox "入力"」のように出る。名前がないものだけを拾う */
    const lines = snapshot
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^- (textbox|combobox|spinbutton|slider|button|checkbox|radio)(:|$| \[)/.test(l));
    /** 入力例（placeholder）も名前として読まれるため、上の確認だけでは見落とす。label か aria-label があるかを調べる */
    const noLabel = await page.locator('main').evaluate((main) =>
      Array.from(main.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select'))
        .filter((el) => el.getAttribute('aria-hidden') !== 'true' && el.type !== 'file')
        .filter((el) => !el.labels?.length && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby'))
        .map((el) => `${el.tagName.toLowerCase()} placeholder="${el.getAttribute('placeholder') ?? ''}"`),
    );
    if (lines.length + noLabel.length > 0) unnamed[id] = [...lines, ...noLabel];
  }
  expect(unnamed).toEqual({});
});

test('切り替えボタンで、選択中のものが読み上げソフトに伝わる（aria-pressed）', async ({ page }) => {
  await page.goto('./#/base64');
  const format = page.getByRole('group', { name: '形式' });
  await expect(format.getByRole('button', { name: 'Base64', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await format.getByRole('button', { name: 'Base64URL' }).click();
  await expect(format.getByRole('button', { name: 'Base64URL' })).toHaveAttribute('aria-pressed', 'true');
  await expect(format.getByRole('button', { name: 'Base64', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const direction = page.getByRole('group', { name: '方向' });
  await direction.getByRole('button', { name: 'デコード' }).click();
  await expect(direction.getByRole('button', { name: 'デコード' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('./#/password');
  const kind = page.getByRole('group', { name: '種類' });
  await kind.getByRole('button', { name: 'PIN（数字のみ）' }).click();
  await expect(kind.getByRole('button', { name: 'PIN（数字のみ）' })).toHaveAttribute('aria-pressed', 'true');
  await expect(kind.getByRole('button', { name: 'パスワード' })).toHaveAttribute('aria-pressed', 'false');
});

test('ツール検索：開いた直後やマウスを乗せただけでは一覧がスクロールしない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./');
  await openPalette(page);
  const list = page.locator('.palette-list');
  expect(await list.evaluate((l) => l.scrollTop)).toBe(0);
  /**
   * 一覧の下端で一部が隠れている候補の、見えている部分にマウスを乗せる（hover() は自動でスクロールするため使わない）。
   * 画面の高さによっては候補の境目がちょうど下端に来るので、そのときは候補の半分だけずらしてから探す
   */
  const target = await list.evaluate((l) => {
    const findPartial = () => {
      const box = l.getBoundingClientRect();
      const partial = [...l.querySelectorAll('[role="option"]')].find((o) => {
        const r = o.getBoundingClientRect();
        return r.top < box.bottom - 4 && r.bottom > box.bottom + 4;
      });
      if (!partial) return null;
      const r = partial.getBoundingClientRect();
      return { x: r.left + 20, y: (r.top + box.bottom) / 2 };
    };
    let point = findPartial();
    if (!point) {
      l.scrollTop += l.querySelector('[role="option"]')!.getBoundingClientRect().height / 2;
      point = findPartial();
    }
    return point && { ...point, scrollTop: l.scrollTop };
  });
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x, target!.y);
  await settleRendering(page);
  expect(await list.evaluate((l) => l.scrollTop)).toBe(target!.scrollTop);
});

test('「本文へ移動」で、サイドバーを飛ばして本文へ進める', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/json');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('JSON整形');
  const skip = page.getByRole('link', { name: '本文へ移動' });
  /** ふだんは画面の外にあり、最初の Tab で表示される */
  await expect(skip).not.toBeInViewport();
  if (page.context().browser()?.browserType().name() === 'webkit') {
    /**
     * Safari は初期設定では Tab でリンクに移らない（利用者が設定で切り替える。Playwright の WebKit では Option+Tab も効かない）。
     * そのためフォーカスを直接移し、表示と移動だけを確かめる
     */
    await skip.focus();
  } else {
    await page.keyboard.press('Tab');
  }
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page).toHaveURL(/#\/json$/); /** 画面は切り替わらない */
  await page.keyboard.press('Tab');
  await expect(page.locator('main :focus')).toHaveCount(1);
});

test('ページを切り替えると新しいページの見出しにフォーカスが移る（最初に開いたときは移さない）', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/json');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('JSON整形');
  await expect(heading).not.toBeFocused();

  /** サイドバーから */
  await openNavigation(page);
  await page.getByRole('link', { name: 'Base64 / URLエンコード', exact: true }).click();
  await expect(heading).toHaveText('Base64 / URLエンコード');
  await expect(heading).toBeFocused();

  /** ツール検索から */
  await (await openPalette(page)).fill('uuid');
  await page.keyboard.press('Enter');
  await expect(heading).toHaveText('UUID / ULID');
  await expect(heading).toBeFocused();

  /** ブラウザの「戻る」でも */
  await page.goBack();
  await expect(heading).toHaveText('Base64 / URLエンコード');
  await expect(heading).toBeFocused();
});

test('お気に入り：ツール画面で登録し、サイドバーとトップに表示して、解除できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/cron');
  const star = page.getByRole('button', { name: 'お気に入り', exact: true });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await openNavigation(page);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'cron式の解説', exact: true })).toHaveCount(2);

  await page.goto('./#/');
  await expect(page.getByRole('heading', { name: 'お気に入り', exact: true })).toBeVisible();

  await page.goto('./#/cron');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await openNavigation(page);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'cron式の解説', exact: true })).toHaveCount(1);
});

test('テーマ：OS の設定より手動の選択を優先し、再読み込みと別のタブにも反映する', CROSS_BROWSER, async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./#/');
  const background = (target = page) => target.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  const light = await background();

  await openNavigation(page);
  await page.getByRole('group', { name: 'テーマ' }).getByRole('button', { name: 'ダーク', exact: true }).click();
  await expect.poll(() => background()).not.toBe(light);
  const dark = await background();
  await page.reload();
  await expect.poll(() => background()).toBe(dark);

  const other = await context.newPage();
  try {
    await other.emulateMedia({ colorScheme: 'dark' });
    await other.goto('./#/');
    await openNavigation(other);
    await other.getByRole('group', { name: 'テーマ' }).getByRole('button', { name: 'ライト', exact: true }).click();
    await expect.poll(() => background(other)).toBe(light);
    await expect.poll(() => background()).toBe(light);

    await other.getByRole('group', { name: 'テーマ' }).getByRole('button', { name: '自動', exact: true }).click();
    await expect.poll(() => background(other)).toBe(dark);
    expect(await other.evaluate(() => localStorage.getItem('dev-toolbox:pref:theme'))).toBeNull();
  } finally {
    await other.close();
  }
});

test('不正な保存値のテーマとお気に入りは無視する', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dev-toolbox:pref:theme', '"<script>"');
    localStorage.setItem('dev-toolbox:pref:favorites', '["no-such-tool", 1]');
  });
  await page.goto('./#/');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.getByRole('heading', { name: 'お気に入り', exact: true })).toHaveCount(0);
});

test.describe('JavaScript が無効のとき', () => {
  test.use({ javaScriptEnabled: false });

  test('真っ白にせず、JavaScript が必要なことを案内する', async ({ page }) => {
    await page.goto('./');
    /** getByText は noscript の中を探さないので、クラスで探す */
    const message = page.locator('.noscript-message');
    await expect(message).toBeVisible();
    await expect(message).toContainText('ブラウザの設定で JavaScript を有効にしてください');
  });
});

test('JavaScript が有効なら、案内を表示しない', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.noscript-message')).toBeHidden();
});
