import { expect, type Page } from '@playwright/test';
import { toolCatalog } from '../src/toolCatalog';

/** アプリ全体の操作（メニュー・ツール検索・全消去）と、描画の待ち合わせ */

export const TOOLS = toolCatalog.map(({ id, name }) => [id, name] as const);

/** 描画後の副作用を待つ。経過時間そのものを検査する場合はpage.clockを使う。 */
export async function settleRendering(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** SPでは検索・ツール一覧・保存設定を先にメニューから開く。 */
export async function openNavigation(page: Page) {
  /** 描画の前に isVisible を確かめると、SPでもメニューを開かずに進んでしまう */
  await page.getByRole('link', { name: /Dev Toolbox/ }).waitFor();
  const toggle = page.getByRole('button', { name: 'メニューを開く', exact: true });
  if (await toggle.isVisible()) await toggle.click();
}

/**
 * Ctrl+K でツール検索を開く。
 * ページを開いた直後は、キー操作を受け取る処理の登録が間に合わず押しても開かないことがあるため、開くまで押し直す
 */
export async function openPalette(page: Page) {
  const combobox = page.getByRole('combobox', { name: 'ツールを検索' });
  await expect(async () => {
    /** 前回の押下で開いていれば押さない（Ctrl+K は開閉の切り替えなので、押すと閉じてしまう） */
    if ((await combobox.count()) === 0) await page.keyboard.press('Control+k');
    await expect(combobox).toBeFocused({ timeout: 1000 });
  }).toPass();
  return combobox;
}

/**
 * 「保存データをすべて消去」を2回押す（1回目で確認の表示になり、2回目で消去して再読み込みする）。
 * 確認の表示は4秒で元に戻るため、Playwright の操作として2回押すと、負荷で2回目が遅れたときに、
 * 戻った後のボタンを押して消去されない（負荷が高いと WebKit で起きる）。ページの中で続けて押す
 */
export async function clickClearAll(page: Page) {
  await openNavigation(page);
  await page.getByRole('button', { name: '保存データをすべて消去', exact: true }).evaluate(async (button: HTMLButtonElement) => {
    button.click();
    /** 表示の更新は押した直後に行われるため、ページの中で少しだけ待つ（4秒よりずっと短い） */
    for (let i = 0; i < 100 && button.textContent !== 'もう一度押すと消去します'; i++) await new Promise((r) => setTimeout(r, 10));
    if (button.textContent !== 'もう一度押すと消去します') throw new Error(`確認の表示になっていない：${button.textContent}`);
    /** 2回目で再読み込みが始まると、この evaluate の実行環境も消えて失敗するため、押すのは evaluate が返った後にする */
    setTimeout(() => button.click(), 0);
  });
}
