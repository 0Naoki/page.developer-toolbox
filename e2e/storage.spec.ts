/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 入力の保存と消去：入力を localStorage に保存せず、タブ内（sessionStorage）だけに残すこと。機密値・編集履歴を含む全消去、西暦入力の保存先と復元
 * - 保存と全消去の競合：全消去通知を遅らせても、通知前の編集が入力を書き戻さないこと
 * - 離れていた間の全消去：別のページへ移動していたタブに戻っても、その間の全消去より前の入力を復元しないこと。起動時に削除できないときは入力画面を出さず、再試行後に空欄で再開すること（あわせて `src/lib/storage/index.test.ts`・`src/lib/storage/clear.test.ts`）
 * - 古いキーの整理：以前の版が残したキー（localStorage の入力・保存設定・名前空間のない表示設定）と、削除したツールの入力・設定を起動時に消し、入力や設定として読まないこと。
 *   新しく開いたタブが古いキーを消しても、開いているほかのタブを全消去させないこと。テーマを初期値へ戻すと別タブにも反映すること。ツールIDが予約した先頭と重ならないこと（あわせて `src/lib/storage/index.test.ts`・`src/lib/storage/preferences.test.ts`・`src/registry.test.ts`）
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { CROSS_BROWSER } from './tags';
import { clickClearAll, openNavigation } from './app';

/** このアプリの入力（:input:）と、入力を保存する設定（:setting:。今の版は持たない）のキー */
const storedKeys = (page: Page) => page.evaluate(() => {
  const pick = (k: string) => k.includes(':input:') || k.includes(':setting:');
  return { local: Object.keys(localStorage).filter(pick), session: Object.keys(sessionStorage).filter(pick) };
});

/** 1つの入力キーの、localStorage と sessionStorage の値 */
const inputLocation = (page: Page, key: string) => page.evaluate((k) => ({
  local: localStorage.getItem(`dev-toolbox:input:${k}`),
  session: sessionStorage.getItem(`dev-toolbox:input:${k}`),
}), key);

test('起動時の全消去に失敗しても旧入力を表示せず、タブ内の削除を再試行できる', CROSS_BROWSER, async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-startup-seeded')) {
      sessionStorage.setItem('e2e-startup-seeded', '1');
      sessionStorage.setItem('dev-toolbox:input:json', '{"old":true}');
      sessionStorage.setItem('dev-toolbox:event:tab-generation', 'before');
      localStorage.setItem('dev-toolbox:event:clear', 'after');
      localStorage.setItem('dev-toolbox:pref:theme', '"dark"');
    }
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (this === sessionStorage && key === 'dev-toolbox:input:json' && !sessionStorage.getItem('e2e-allow-remove')) {
        throw new DOMException('denied', 'SecurityError');
      }
      remove.call(this, key);
    };
  });
  await page.goto('./#/json');
  await expect(page.getByRole('heading', { name: '保存データの全消去' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveCount(0);
  expect((await inputLocation(page, 'json')).session).toBe('{"old":true}');
  await page.evaluate(() => sessionStorage.setItem('e2e-allow-remove', '1'));
  await page.getByRole('button', { name: '全消去を再試行', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
  expect((await inputLocation(page, 'json')).session).toBeNull();
  expect(await page.evaluate(() => [localStorage.getItem('dev-toolbox:event:clear'), localStorage.getItem('dev-toolbox:pref:theme')])).toEqual(['after', '"dark"']);
});

test('第n営業日は再読み込み後もタブ内に残り、localStorage には書かない', async ({ page }) => {
  await page.goto('./#/bizdays');
  await page.getByRole('button', { name: '月ごとの営業日' }).click();
  const input = page.getByRole('textbox', { name: /営業日も表示/ });
  await expect(input).toHaveValue('5');
  await input.fill('17');
  await page.reload();
  await expect(input).toHaveValue('17');
  expect(await inputLocation(page, 'bizdays:nth')).toEqual({ local: null, session: '17' });
});

test('入力を localStorage に保存する設定を表示しない', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/json');
  await openNavigation(page);
  await expect(page.getByRole('button', { name: '保存データをすべて消去', exact: true })).toBeVisible();
  await expect(page.getByText('入力の保存対象を選択', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /の入力を保存する$/ })).toHaveCount(0);
});

test('以前の版が残したキーと削除したツールの設定は、起動時に消し、入力や設定として読まない', CROSS_BROWSER, async ({ page }) => {
  /** 以前の版は入力を localStorage に保存していた。残っていると同じオリジンのほかのサイトから読めるため、移さずに消す */
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.setItem('dev-toolbox:setting:persistInputs', '["json"]');
    localStorage.setItem('dev-toolbox:setting:persistInputs:json', '1');
    localStorage.setItem('dev-toolbox:input:json', '{"saved":true}');
    localStorage.setItem('dev-toolbox:json:indent', '4');
    localStorage.setItem('dev-toolbox:sql:indent', '2');
    localStorage.setItem('dev-toolbox:pref:recent', JSON.stringify(['json']));
    sessionStorage.setItem('dev-toolbox:input:biz:nth', '17');
  });
  await page.goto('./#/json');
  await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
  const appKeys = (area: 'localStorage' | 'sessionStorage') => page.evaluate((name) => Object.keys(window[name]).filter((k) => k.startsWith('dev-toolbox:')).sort(), area);
  /** 今の形式の表示設定は残す（最近使ったツールは、開いた json で更新される） */
  expect(await appKeys('localStorage')).toEqual(['dev-toolbox:pref:recent']);
  /** 以前の略称（biz:）の入力も、今のツールの入力として読まずに消す */
  expect(await appKeys('sessionStorage')).toEqual([]);
});

test('回帰：新しく開いたタブが古いキーを消しても、開いているタブを全消去させない', CROSS_BROWSER, async ({ page, context }) => {
  await page.goto('./#/json');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  await input.fill('{"editing":1}');
  /** 以前の版のタブが残した設定（配列）。新しく開いたタブが起動時に消す */
  await page.evaluate(() => localStorage.setItem('dev-toolbox:setting:persistInputs', '["json"]'));
  let reloaded = false;
  page.on('load', () => { reloaded = true; });
  const other = await context.newPage();
  try {
    await other.goto('./#/json');
    await expect.poll(() => other.evaluate(() => localStorage.getItem('dev-toolbox:setting:persistInputs'))).toBeNull();
    await expect(input).toHaveValue('{"editing":1}');
    expect(await page.evaluate(() => sessionStorage.getItem('dev-toolbox:input:json'))).toBe('{"editing":1}');
    expect(reloaded).toBe(false);
  } finally {
    await other.close();
  }
});

test('和暦の西暦入力をタブ内に保持し、移動・再読込後に復元する。新しいタブには残さない', CROSS_BROWSER, async ({ page, context }) => {
  await page.goto('./#/wareki');
  const input = page.getByRole('textbox', { name: '西暦の日付', exact: true });
  await input.fill('1990-01-01');
  await openNavigation(page);
  await page.getByRole('navigation').getByRole('link', { name: 'JSON整形', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('JSON整形');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await openNavigation(page);
  await page.getByRole('navigation').getByRole('link', { name: '和暦 ⇔ 西暦', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('和暦 ⇔ 西暦');
  await expect(input).toHaveValue('1990-01-01');
  await page.reload();
  await expect(input).toHaveValue('1990-01-01');
  expect(await inputLocation(page, 'wareki:seireki')).toEqual({ local: null, session: '1990-01-01' });
  const fresh = await context.newPage();
  try {
    await fresh.goto('./#/wareki');
    await expect(fresh.getByRole('textbox', { name: '西暦の日付', exact: true })).not.toHaveValue('1990-01-01');
  } finally {
    await fresh.close();
  }
});

test('修正確認：全消去で各タブの入力・機密値・編集履歴を破棄し、再保存しない', CROSS_BROWSER, async ({ page, context }) => {
  /** 4タブの再読み込みと再確認を行うため、WebKitでも全手順を検証できる時間を確保する。 */
  test.setTimeout(60_000);
  /** 入力した値と、消えたことを確かめる値は同じ定数にする（別々に書くと、綴りの違いで確認が空振りするため） */
  const SESSION_ONLY_VALUE = 'private-data';
  await page.goto('./#/json');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('{"secret":123}');
  const other = await context.newPage();
  const sessionOnly = await context.newPage();
  const memoryOnly = await context.newPage();
  try {
    await other.goto('./#/json');
    await other.getByRole('textbox', { name: '入力', exact: true }).fill('{"secret":456}');
    await sessionOnly.goto('./#/base64');
    await sessionOnly.getByRole('textbox', { name: '入力', exact: true }).fill(SESSION_ONLY_VALUE);
    await memoryOnly.goto('./#/jwt');
    await memoryOnly.getByRole('textbox', { name: 'トークン', exact: true }).fill('memory-secret');
    const reloaded = Promise.all([page, other, sessionOnly, memoryOnly].map((tab) => tab.waitForEvent('load')));
    await clickClearAll(page);
    await reloaded;
    await expect(memoryOnly.getByRole('textbox', { name: 'トークン', exact: true })).toHaveValue('');
    for (const tab of [page, other, sessionOnly]) {
      await expect(tab.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
      const stored = await tab.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
      expect(stored).not.toContain('secret');
      expect(stored).not.toContain(SESSION_ONLY_VALUE);
      await tab.reload();
      await expect(tab.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
    }
  } finally {
    await other.close();
    await sessionOnly.close();
    await memoryOnly.close();
  }
});

test('回帰：別のページへ移動していたタブに戻っても、その間の全消去より前の入力を復元しない', CROSS_BROWSER, async ({ page, context }) => {
  /** 全消去の通知はアプリを開いているタブにしか届かないため、戻ったタブで sessionStorage から消去前の入力が復元されていた */
  const key = 'dev-toolbox:input:json';
  await page.goto('./#/json');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  await input.fill('{"before-clear":1}');
  await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), key)).toBe('{"before-clear":1}');
  /** 同じオリジンの別のページへ移動する（アプリはこのタブで動いていない） */
  await page.goto('./favicon.svg');
  const other = await context.newPage();
  try {
    await other.goto('./#/json');
    const reloaded = other.waitForEvent('load');
    await clickClearAll(other);
    await reloaded;
    /** 戻る・進むのキャッシュから戻っても、読み込み直しても、消去前の入力を表示せず、保存領域にも残さない */
    await page.goBack();
    await expect(input).toHaveValue('');
    await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
    await page.reload();
    await expect(input).toHaveValue('');
  } finally {
    await other.close();
  }
});

test('全消去の通知が遅れたタブも、消去の後の編集で入力を書き戻さない', CROSS_BROWSER, async ({ page, context }) => {
  await page.goto('./#/json');
  const key = 'dev-toolbox:input:json';
  const other = await context.newPage();
  try {
    await other.addInitScript(() => {
      let hold = true;
      /** 消去通知より先に、このタブで編集する順序を再現する。 */
      Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
      window.addEventListener('storage', (event) => {
        if (hold) event.stopImmediatePropagation();
      }, true);
      window.addEventListener('release-clear-notification', () => {
        hold = false;
        const key = 'dev-toolbox:event:clear';
        window.dispatchEvent(new StorageEvent('storage', { key, newValue: localStorage.getItem(key), storageArea: localStorage }));
      }, { once: true });
    });
    await other.goto('./#/json');
    const input = other.getByRole('textbox', { name: '入力', exact: true });
    await input.fill('{"before-clear":1}');
    await expect.poll(() => other.evaluate((k) => sessionStorage.getItem(k), key)).toBe('{"before-clear":1}');
    const reloaded = Promise.all([page.waitForEvent('load'), other.waitForEvent('load')]);
    await clickClearAll(page);
    await expect.poll(() => other.evaluate(() => localStorage.getItem('dev-toolbox:event:clear'))).toBeTruthy();
    /** 消去世代が変わった後の編集は、通知が届く前でも書かない */
    await input.fill('{"late":3}');
    expect(await other.evaluate((k) => sessionStorage.getItem(k), key)).toBe('{"before-clear":1}');
    await other.evaluate(() => window.dispatchEvent(new Event('release-clear-notification')));
    await reloaded;
    for (const tab of [page, other]) {
      await expect(tab.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
      expect(await tab.evaluate((k) => [localStorage.getItem(k), sessionStorage.getItem(k)], key)).toEqual([null, null]);
    }
  } finally {
    await other.close();
  }
});

test('テーマを初期値へ戻した変更も別タブへ反映する', CROSS_BROWSER, async ({ page, context }) => {
  await page.goto('./#/');
  await page.evaluate(() => localStorage.setItem('dev-toolbox:pref:theme', '"dark"'));
  await page.reload();
  const other = await context.newPage();
  try {
    await other.goto('./#/');
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openNavigation(page);
    await page.getByRole('group', { name: 'テーマ', exact: true }).getByRole('button', { name: '自動', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    await expect(other.locator('html')).not.toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => [localStorage.getItem('dev-toolbox:pref:theme'), localStorage.getItem('dev-toolbox:theme')])).toEqual([null, null]);
    await other.reload();
    await expect(other.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  } finally { await other.close(); }
});

test('年をまたいで選択範囲外になった保存年は表示と集計の両方で当年に戻る', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-06T03:00:00Z'));
  await page.goto('./#/bizdays');
  await page.getByRole('button', { name: '月ごとの営業日' }).click();
  const year = page.getByRole('combobox', { name: '年', exact: true });
  await year.selectOption('2016');
  await page.clock.setFixedTime(new Date('2027-01-02T03:00:00Z'));
  await page.reload();
  await expect(year).toHaveValue('2027');
  await expect(page.getByRole('row').filter({ hasText: '1/4（月）' }).first()).toHaveClass('current');
});

/** 入力欄の種類ごとに、編集した入力がタブ内（sessionStorage）にだけ残ること（入力の保存の入口は useInput だけ） */
const TAB_ONLY_INPUTS: { name: string; path: string; field: (page: Page) => Locator; value: string; key: string }[] = [
  { name: 'JSON整形の入力', path: './#/json', field: (page) => page.locator('textarea').first(), value: '{"secret":"x"}', key: 'json' },
  { name: 'UNIX時間のエポック', path: './#/time', field: (page) => page.getByPlaceholder('1790899200'), value: '1790899200', key: 'time:epoch' },
  { name: '営業日計算の会社独自の休日', path: './#/bizdays', field: (page) => page.getByLabel('会社独自の休日（1行に1日付）'), value: '2026-08-13', key: 'bizdays:extra' },
];

for (const { name, path, field, value, key } of TAB_ONLY_INPUTS) {
  test(`${name}はタブ内（sessionStorage）にだけ残り、localStorage には書かない`, CROSS_BROWSER, async ({ page }) => {
    await page.goto(path);
    await field(page).fill(value);
    await expect.poll(() => inputLocation(page, key)).toEqual({ local: null, session: value });
    /** 編集した欄以外の入力も、localStorage には1つもない */
    expect((await storedKeys(page)).local).toEqual([]);
  });
}

test('全消去の一部に失敗した場合はツールを閉じ、再試行できる', CROSS_BROWSER, async ({ page }) => {
  await page.goto('./#/json');
  await page.evaluate(() => {
    localStorage.setItem('dev-toolbox:input:json', 'secret');
    localStorage.setItem('dev-toolbox:pref:recent', '[]');
    sessionStorage.setItem('dev-toolbox:input:base64', 'secret');
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (!document.documentElement.dataset.allowRemoval && this === localStorage && key === 'dev-toolbox:input:json') throw new Error('削除不可');
      remove.call(this, key);
    };
  });
  const clear = page.getByRole('button', { name: '保存データをすべて消去', exact: true });
  await clear.click();
  await page.getByRole('button', { name: 'もう一度押すと消去します' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '一部を消去できませんでした' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.getItem('dev-toolbox:pref:recent'), sessionStorage.getItem('dev-toolbox:input:base64')])).toEqual([null, null]);
  await page.evaluate(() => { document.documentElement.dataset.allowRemoval = 'yes'; });
  await page.getByRole('button', { name: '全消去を再試行' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '共有の保存データ' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dev-toolbox:input:json'))).toBe('secret');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '現在の保存データをすべて消去' }).click();
  await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('dev-toolbox:input:json'))).toBeNull();
});
