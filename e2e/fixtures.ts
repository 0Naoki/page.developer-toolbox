import { test as base, expect } from '@playwright/test';
import { watch } from './watch';

export { expect } from '@playwright/test';

/** ページを渡す前に監視を開始し、終了時に通信・CSP・実行時エラーを検査する。 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    if (!baseURL) throw new Error('プレビューの baseURL が必要です');
    const problems = await watch(page, new URL(baseURL).origin);
    try {
      await use(page);
    } finally {
      expect(problems, '外部通信・CSP違反・実行時エラー').toEqual([]);
    }
  },
});
