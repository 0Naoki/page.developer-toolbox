/** パスワードを出力せず、HEAD と作業ツリーの文字集合の準備・一括生成の時間を比べる。 */
import { comparisonArguments, createComparison, measure } from './benchmark.mjs';
import { passwordInputs } from './password-inputs.mjs';

const entry = 'src/tools/password-generator/logic.ts';
const { outputPath, ...options } = comparisonArguments();
const comparison = await createComparison(entry, options);
comparison.trackFile('scripts/password-inputs.mjs');
const { versions } = comparison;
const cases = [];
for (const { symbols, ...shape } of passwordInputs()) {
  for (const count of [1, 5, 20]) {
    const timings = {};
    for (const [name, api] of Object.entries(versions)) {
      const options = { ...api.DEFAULT_OPTIONS, symbolSet: symbols };
      let plan;
      const preparation = api.createPasswordPlan ? measure(() => { plan = api.createPasswordPlan(options); if (!plan.ok) throw new Error(plan.error); }) : null;
      const generationFromPlan = plan ? measure(() => {
        for (let i = 0; i < count; i++) if (Array.from(plan.generate()).length !== options.length) throw new Error('生成文字数が一致しません');
      }) : null;
      const batch = measure(() => {
        const generated = api.generateMany(options, count);
        if (generated.length !== count) throw new Error('生成件数が一致しません');
      });
      timings[name] = { preparation, generationFromPlan, batch };
    }
    cases.push({ ...shape, symbolSetUtf16: symbols.length, count, timings });
  }
}
comparison.writeReport({
  input: '同じ文字の反復と、すべて異なる補助平面のUnicodeスカラー。他は DEFAULT_OPTIONS。結果のパスワードは記録しない。',
  scope: 'preparationは検証と生成計画の準備、generationFromPlanは準備済み計画からの生成、batchはgenerateMany全体。計画APIのない版は個別区間をnullとする。重複する区間を合算しない。入力作成・描画・設定保存は除外。HEAD の入口と作業ツリーの依存を使用。',
  cases,
}, outputPath);
