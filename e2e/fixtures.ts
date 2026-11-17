import { test as base, expect } from '@playwright/test';
import { watch } from './watch';

export { expect } from '@playwright/test';

/**
 * タブを開く前に監視を開始し、終了時に通信・CSP・実行時エラーを検査する。
 *
 * @remarks
 * 監視はコンテキスト単位で行う。page だけを監視すると、テストの途中で context.newPage() で開いたタブ
 * （別タブとの同期・全消去の検査など）の通信や CSP 違反を見逃すため。
 */
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (!baseURL) throw new Error('プレビューの baseURL が必要です');
    const problems = await watch(context, new URL(baseURL).origin);
    try {
      await use(context);
    } finally {
      expect(problems, '外部通信・CSP違反・実行時エラー（すべてのタブ）').toEqual([]);
    }
  },
});
