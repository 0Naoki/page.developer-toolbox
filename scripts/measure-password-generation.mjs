/** パスワードを出力せず、HEAD と作業ツリーの文字集合の準備・一括生成の時間を比べる。 */
import { createComparison, measure } from './benchmark.mjs';

const entry = 'src/tools/password-generator/logic.ts';
const comparison = await createComparison(entry);
const { versions } = comparison;
const cases = [];
for (const length of [1000, 100000, 1000000]) {
  for (const count of [1, 5, 20]) {
    const timings = {};
    for (const [name, api] of Object.entries(versions)) {
      const options = { ...api.DEFAULT_OPTIONS, symbolSet: '!'.repeat(length) };
      timings[name] = measure(() => {
        const generated = api.generateMany(options, count);
        if (generated.length !== count) throw new Error('生成件数が一致しません');
      });
    }
    cases.push({ symbolSetLength: length, count, timings });
  }
}
comparison.writeReport({
  input: '記号 ! の繰り返し。他は DEFAULT_OPTIONS。結果のパスワードは記録しない。',
  scope: '純粋な生成処理のみ。画面の描画・設定の保存は含まない。HEAD の入口と作業ツリーの依存を使用。',
  cases,
}, process.argv[2]);
