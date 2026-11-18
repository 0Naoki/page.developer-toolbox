/** 診断の種類数を変え、通常集計の中間データと、操作時の全件出力を分けて測る。 */
import { serialize } from 'node:v8';
import { comparisonArguments, createComparison, measure } from './benchmark.mjs';

const entry = 'src/tools/text-count/count.ts';
const { outputPath, ...options } = comparisonArguments();
const comparison = await createComparison(entry, options);
const reports = await comparison.loadWorkingTree('src/tools/text-count/reports.ts');
const measurement = await comparison.loadWorkingTree('src/tools/text-count/logic.ts');
const cases = [];
for (const codePoints of [1000, 10_000, 100_000]) {
  for (const alphabet of ['repeated', 'distinct']) {
    const input = alphabet === 'repeated' ? '😀'.repeat(codePoints) : Array.from({ length: codePoints }, (_, i) => String.fromCodePoint(0x10000 + i)).join('');
    const versions = {};
    for (const [name, api] of Object.entries(comparison.versions)) {
      let result;
      const counting = measure(() => { result = api.countText(input, { newline: 'none' }); });
      const total = result.issueTotals?.unsupported ?? result.unsupported.length;
      if (total !== (alphabet === 'repeated' ? 1 : codePoints) || result.codePoints !== codePoints) throw new Error('診断の種類数または文字数が一致しません');
      versions[name] = { counting, intermediateBytes: serialize(result).byteLength,
        retainedDetails: { sjis: result.unsupported.length, eucjp: result.unsupportedEuc.length }, unsupportedTotal: total };
    }
    const normalMeasurement = measure(() => {
      const result = measurement.measureText(input, { newline: 'none', measure: 'chars' });
      if (result.counts.unsupported.length > 100) throw new Error('通常の表示上限を超えています');
    });
    let report;
    const fullReport = measure(() => { report = reports.createDiagnosticReport(input, 'unsupported'); });
    cases.push({ alphabet, codePoints, inputUtf16: input.length, distinctSymbols: alphabet === 'repeated' ? 1 : codePoints, versions,
      normalMeasurement, fullReport, fullReportUtf16: report.length });
  }
}
comparison.writeReport({
  input: '同じ絵文字の反復と、すべて異なる補助平面のUnicodeスカラー。改行は含めない。',
  scope: 'countingは文字数・バイト数と診断の集計。intermediateBytesはcountTextの中間結果のV8サイズで、Worker転送量やピークヒープではない。normalMeasurementは現行の行別測定と不可視検査を含む通常集計。fullReportは操作時のShift_JIS診断の全件TSV生成。入力作成・描画・コピー・保存は除外。区間は重複するので合算しない。',
  cases,
}, outputPath);
