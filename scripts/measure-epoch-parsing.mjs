/** 合成したエポック入力を拒否・解析する時間を、HEAD と作業ツリーで比較する。 */
import { createComparison, measure } from './benchmark.mjs';

const entry = 'src/tools/unix-time/epoch.ts';
const comparison = await createComparison(entry);
const { versions } = comparison;
const cases = [
  ...[1000, 1000000, 8000000].map((length) => ({ name: '範囲外の9の繰り返し', input: '9'.repeat(length), expected: null })),
  { name: '先頭の0が長い有効値', input: '0'.repeat(8000000) + '1', expected: 1000 },
  { name: '小数部が長い有効値', input: '1.001' + '9'.repeat(8000000), expected: 1001 },
];
const measurements = [];
for (const item of cases) {
  const timings = {};
  for (const [name, api] of Object.entries(versions)) {
    const run = () => {
      let value = null;
      try { value = api.parseEpoch(item.input).date.getTime(); }
      catch (error) { if (error.message !== '日時に変換できない値です') throw error; }
      if (value !== item.expected) throw new Error('期待した結果と一致しません');
    };
    timings[name] = measure(run);
  }
  measurements.push({ name: item.name, inputLength: item.input.length, expectedMillis: item.expected, timings });
}
comparison.writeReport({
  scope: 'Node の単一エポック解析のみ。入力文字列の準備・画面・保存は対象外。HEAD の入口も依存は作業ツリーから読む。',
  cases: measurements,
}, process.argv[2]);
