/** 検査の対象：src/calculation/handlers.ts・protocol.ts と、そこから呼ぶツールの結果の整形（csv-json・text-diff の calculation.ts、json-formatter の formatJsonForScreen） */
import { describe, expect, it } from 'vitest';
import { calculate, UNKNOWN_CALCULATION } from './handlers';
import { calculateDiff } from '../tools/text-diff/calculation';
import { acceptResponse, calculationInputSize } from './protocol';
import { MAX_CALCULATION_INPUT } from '../lib/worker/calculationLimits';
import { textPreview } from '../lib/text/textPreview';
import { DEFAULT_CSV_TO_JSON } from '../tools/csv-json/logic';
import { DEFAULT_JSON_TO_CSV } from '../tools/csv-json/writeCsv';

describe('画面から分離した計算', () => {
  it('均等分割のコピー用出力は表示上限を超えても全件を返す', () => {
    for (const [input, newPrefix, count, first, last] of [
      ['10.0.0.0/16', 28, 4096, '10.0.0.0/28', '10.0.255.240/28'],
      ['2001:db8::/48', 64, 65536, '2001:db8::/64', '2001:db8:0:ffff::/64'],
    ] as const) {
      const result = calculate({ tool: 'subnetSplit', input, newPrefix });
      expect(result).toMatchObject({ output: expect.any(String) });
      const lines = (result as { output: string }).output.split('\n');
      expect(lines).toHaveLength(count);
      expect(lines[0]).toBe(first);
      expect(lines.at(-1)).toBe(last);
    }
  });

  it('均等分割の出力上限を超えると、不完全な一覧を返さず拒否する', () => {
    expect(() => calculate({ tool: 'subnetSplit', input: '::/0', newPrefix: 128 })).toThrow('100,000');
    expect(() => calculate({ tool: 'subnetSplit', input: '10.0.0.0/8', newPrefix: 32 })).toThrow('100,000');
  });

  it('HANDLERS にない計算の種類は、Object.prototype のメソッドも含めて呼ばずにエラーにする', () => {
    /** Worker が受け取るメッセージの tool は実行時には型で守られないため、決まった種類以外を呼ばないことを確かめる */
    for (const tool of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'unknown']) {
      const request = { tool, input: '' } as unknown as Parameters<typeof calculate>[0];
      expect(() => calculate(request), tool).toThrow(UNKNOWN_CALCULATION);
    }
  });
  it('CSVの双方向変換を行い、元の数値表記を保つ', () => {
    const options = { tool: 'csv' as const, csvOptions: DEFAULT_CSV_TO_JSON, jsonOptions: DEFAULT_JSON_TO_CSV };
    expect(calculate({ ...options, direction: 'json2csv', input: '[{"n":9007199254740993,"d":100.00}]' }))
      .toMatchObject({ output: 'n,d\r\n9007199254740993,100.00', summary: '1行 × 2列', warnings: [] });
    expect(calculate({ ...options, direction: 'csv2json', input: 'n\n00123' }))
      .toMatchObject({ output: '[\n  {\n    "n": "00123"\n  }\n]', summary: '1行 × 1列' });
  });
  it('CSV→JSON では空白だけの入力も CSV として読み、JSON→CSV では空として扱う', () => {
    const options = { tool: 'csv' as const, csvOptions: { ...DEFAULT_CSV_TO_JSON, header: false }, jsonOptions: DEFAULT_JSON_TO_CSV };
    expect(calculate({ ...options, direction: 'csv2json', input: ' ' })).toMatchObject({ output: '[\n  [\n    " "\n  ]\n]', summary: '1行 × 1列' });
    expect(calculate({ ...options, direction: 'csv2json', input: '' })).toEqual({ output: '', summary: '', warnings: [] });
    expect(calculate({ ...options, direction: 'json2csv', input: ' \n ' })).toEqual({ output: '', summary: '', warnings: [] });
  });
  it('JSON の大きな整数・小数・エスケープ・重複キーの表記を保つ', () => {
    const result = calculate({ tool: 'json', input: '{"n":9007199254740993,"d":100.00,"s":"\\u3042","n":1}', indent: 'minify', sortKeys: false });
    expect(result).toMatchObject({ ok: true, output: '{"n":9007199254740993,"d":100.00,"s":"\\u3042","n":1}' });
  });

  it('ログの中のエポック時間を、指定したタイムゾーンと書き方で変換する', () => {
    expect(calculate({ tool: 'epoch', input: '1700000000 INFO', zone: 'UTC', mode: 'replace' }))
      .toEqual({ output: '2023-11-14 22:13:20 +00:00 INFO', count: 1 });
  });

  it('大量の重複キーは内容を保ち、転送する警告の数だけを制限する', () => {
    const input = '{' + Array(100).fill('"a":1').join(',') + '}';
    const result = calculate({ tool: 'json', input, indent: 'minify', sortKeys: false });
    expect(result).toMatchObject({ ok: true, output: input });
    if (typeof result !== 'string' && 'ok' in result && result.ok) {
      expect(result.warnings).toHaveLength(6);
      expect(result.warnings.at(-1)).toBe('ほか 94 件の警告があります');
    }
  });

  it('差分と全文を別の要求で返し、どちらも2つの入力の合計で大きさを確かめる', () => {
    const result = calculate({ tool: 'diff', input: 'a\nb\n', after: 'a\nc\n', ignoreWhitespace: false, ignoreCase: false });
    expect(result).toMatchObject({ added: 1, removed: 1 });
    expect(calculate({ tool: 'diffUnified', inputSize: 8, rows: result.rows })).toBe('--- before\n+++ after\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n');
    const half = ' '.repeat(MAX_CALCULATION_INPUT / 2 + 1);
    expect(() => calculate({ tool: 'diff', input: half, after: half, ignoreWhitespace: false, ignoreCase: false })).toThrow('入力が大きすぎます');
    expect(() => calculate({ tool: 'diffUnified', inputSize: half.length * 2, rows: result.rows })).toThrow('入力が大きすぎます');
    for (const inputSize of [-1, 0.5, NaN, Infinity]) {
      expect(() => calculate({ tool: 'diffUnified', inputSize, rows: result.rows })).toThrow('入力が大きすぎます');
    }
  });

  it('大きすぎる入力を解析前に拒否する', () => {
    expect(() => calculate({ tool: 'json', input: ' '.repeat(MAX_CALCULATION_INPUT + 1), indent: 2, sortKeys: false })).toThrow('入力が大きすぎます');
    expect(() => calculate({ tool: 'jwt', input: ' '.repeat(MAX_CALCULATION_INPUT + 1) })).toThrow('入力が大きすぎます');
    expect(calculate({ tool: 'jwt', input: '' })).toBeNull();
  });

  it('深い入れ子の整形で出力を際限なく増やさない', () => {
    const input = '['.repeat(300) + Array(20000).fill('0').join(',') + ']'.repeat(300);
    expect(() => calculate({ tool: 'json', input, indent: 4, sortKeys: false })).toThrow('整形結果が大きすぎます');
  });
});

describe('表示だけの切り詰め', () => {
  it('元の文字列を変えず、境界のサロゲートペアを分断しない', () => {
    const text = 'ab😀cd';
    expect(textPreview(text, 3)).toBe('ab');
    expect(textPreview(text, 4)).toBe('ab😀');
    expect(textPreview(text, 100)).toBe(text);
    expect(textPreview(text, 0)).toBe('');
    expect(text).toBe('ab😀cd');
  });
});

describe('Worker の応答の確かめ', () => {
  it('要求と同じツールの結果だけを受け取り、別のツールの結果はエラーにする', () => {
    const result = calculate({ tool: 'base64', input: 'a', direction: 'encode', mode: 'base64', wrap: false });
    expect(acceptResponse({ tool: 'base64' }, { ok: true, tool: 'base64', result })).toEqual({ ok: true, tool: 'base64', result });
    expect(acceptResponse({ tool: 'json' }, { ok: true, tool: 'base64', result })).toEqual({ ok: false, error: '計算結果を受け取れませんでした。画面を再読み込みしてください。' });
    expect(acceptResponse({ tool: 'json' }, { ok: false, error: 'x' })).toEqual({ ok: false, error: 'x' });
  });
});
it('表示応答には全文パッチを含めず、全文の要求では同じ差分と入力上限を使う', () => {
  const input = 'a\r\nb\r\n', after = 'a\r\nB\r\n';
  const screen = calculateDiff({ input, after, ignoreCase: false, ignoreWhitespace: false });
  expect(screen).not.toHaveProperty('unified');
  const request = { tool: 'diffUnified', inputSize: input.length + after.length, rows: structuredClone(screen.rows) } as const;
  expect(calculationInputSize(request)).toBe(input.length + after.length);
  expect(calculate(request)).toBe('--- before\n+++ after\n@@ -1,2 +1,2 @@\n a\r\n-b\r\n+B\r\n');
});
