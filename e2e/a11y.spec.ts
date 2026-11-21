/**
 * アクセシビリティの自動検査（axe-core）。全ツールの画面を、最初の表示と「サンプル」の入力後の結果の表示で、ライト・ダークの両方で検査する。
 *
 * @remarks
 * 対象は WCAG 2.1 の A・AA の規則（名前のない入力欄・ボタン、見出しやランドマークの構造、ARIA の誤り、文字のコントラストなど）。
 * 色の変数のコントラストは src/styles.contrast.test.ts でも確かめるが、ここでは実際に描画した文字と背景の組み合わせを確かめる。
 * axe は画面に表示している要素だけを検査するため、タブの切り替えの先や操作の後にだけ出る表示は、それぞれのツールの E2E で確かめる。
 *
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R059] 全ツールの WCAG 2.1 AA：進数変換のビットのボタンの名前に表示の 0・1 を含める（label-content-name-mismatch）、
 *   和暦の早見表のスクロールする枠にキーボードで移れる（scrollable-region-focusable）
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { TOOLS, settleRendering } from './app';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** 違反を、規則・影響度・要素の位置の一覧にする（失敗したときに直す場所が分かるように） */
async function violations(page: Page): Promise<string[]> {
  const { violations: found } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return found.flatMap((v) => v.nodes.map((node) => `${v.id}（${v.impact ?? '-'}）：${node.target.join(' ')}：${v.help}`));
}

/**
 * 計算中の表示を検査しないよう、計算の終わりと描画を待つ。
 * 計算の状態の表示（CalculationStatus）は、ツールによっては終わると消えるため、「計算中」がなくなるのを待つ
 */
async function settle(page: Page) {
  await settleRendering(page);
  await expect(page.locator('[data-calculation-state="pending"]')).toHaveCount(0);
  await settleRendering(page);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`アクセシビリティ（${colorScheme === 'light' ? 'ライト' : 'ダーク'}）`, () => {
    test.use({ colorScheme });

    test('トップページに WCAG 2.1 AA の違反がない', async ({ page }) => {
      await page.goto('./');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await settle(page);
      expect(await violations(page)).toEqual([]);
    });

    for (const [id, title] of TOOLS) {
      test(`${title}：最初の表示と、サンプルの結果の表示に WCAG 2.1 AA の違反がない`, async ({ page }) => {
        await page.goto(`./#/${id}`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
        await settle(page);
        expect(await violations(page), '最初の表示').toEqual([]);

        const sample = page.getByRole('button', { name: 'サンプル', exact: true });
        if ((await sample.count()) === 0) return;
        await sample.first().click();
        await settle(page);
        expect(await violations(page), 'サンプルの結果の表示').toEqual([]);
      });
    }
  });
}
