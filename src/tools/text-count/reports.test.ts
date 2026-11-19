/**
 * 回帰テストとして残す検証（docs/TESTING.md）。対象はreports.ts・reportText.ts・issues.ts。
 * - [R055] 文字診断の全件取得：抜粋と総数を分け、全件の文字・位置・件数と出力上限を検査する。
 */
import { expect, it, vi } from 'vitest';
import { countText } from './count';
import { createDiagnosticReport } from './reports';
import * as encoding from './encoding';

it('小さな出力上限では、全種類を収集する前に停止する', () => {
  const input = Array.from({ length: 10_000 }, (_, i) => String.fromCodePoint(0x10000 + i)).join('');
  const spy = vi.spyOn(encoding, 'sjisBytesOf');
  try {
    expect(() => createDiagnosticReport(input, 'unsupported', 200)).toThrow(/入力を分割/);
    expect(spy.mock.calls.length).toBeLessThan(1000);
  } finally { spy.mockRestore(); }
});

it('集約と分割連結で、各文字の件数・位置・表記を変えない', () => {
  const input = '㈱①丂𠮷\r\n😀\t😀\ud800\r𠮷㈱';
  const expected = countText(input, { newline: 'none' });
  for (const kind of ['unsupported', 'unsupportedEuc', 'vendor'] as const) {
    const rows = createDiagnosticReport(input, kind).split('\n').slice(1).map((line) => line.split('\t'));
    expect(rows).toEqual(expected[kind].map((item) => [JSON.stringify(item.char), item.codePoint, String(item.count), item.reason, String(item.line), String(item.column)]));
  }
});

it('後から出現件数の桁が増えた場合も、実際の出力上限を超えない', () => {
  const limit = createDiagnosticReport('😀', 'unsupported').length;
  expect(createDiagnosticReport('😀'.repeat(9), 'unsupported', limit).length).toBe(limit);
  expect(() => createDiagnosticReport('😀'.repeat(10), 'unsupported', limit)).toThrow(/入力を分割/);
});

it('表示は100種類に保ち、先頭の文字の遅い再出現と全文の種類数も数える', () => {
  const chars = Array.from({ length: 1001 }, (_, i) => String.fromCodePoint(0x10000 + i));
  const text = chars.join('') + '\r\n' + chars[0]! + chars[0]!;
  const result = countText(text, { newline: 'lf' });
  expect(result.issueTotals.unsupported).toBe(1001);
  expect(result.unsupported).toHaveLength(100);
  expect(result.unsupported[0]).toMatchObject({ count: 3, line: 1, column: 1 });
  for (const kind of ['unsupported', 'unsupportedEuc'] as const) {
    const lines = createDiagnosticReport(text, kind).split('\n');
    expect(lines).toHaveLength(1002);
    expect(lines.at(-1)).toContain('U+103E8');
    expect(lines[1]?.split('\t').slice(0, 3)).toEqual([JSON.stringify(chars[0]), 'U+10000', '3']);
  }
});

it('不可視文字2001件を省略せず、混在改行・絵文字の位置も元のUTF-16位置で出力する', () => {
  const lines = createDiagnosticReport('\t'.repeat(2001), 'invisibleOccurrences').split('\n');
  expect(lines).toHaveLength(2002);
  expect(lines.at(-1)).toBe('1\t2001\t2000\tU+0009\t水平タブ');
  expect(createDiagnosticReport('😀\t\r\nA\u200b\rB\t\n', 'invisibleOccurrences').split('\n').slice(1)).toEqual([
    '1\t2\t2\tU+0009\t水平タブ', '2\t2\t6\tU+200B\tゼロ幅スペース', '3\t2\t9\tU+0009\t水平タブ',
  ]);
});

it('種類別集計の100種類以降も取得し、出力上限では途中の診断を返さない', () => {
  const selectors = Array.from({ length: 201 }, (_, i) => String.fromCodePoint(0xe0100 + i)).join('');
  expect(createDiagnosticReport(selectors, 'invisibleKinds').split('\n')).toHaveLength(202);
  expect(() => createDiagnosticReport('\t'.repeat(20), 'invisibleOccurrences', 200)).toThrow(/入力を分割/);
  expect(createDiagnosticReport('\ud800', 'unsupported')).toContain('"\\ud800"');
  expect(createDiagnosticReport('㈱①㈱', 'vendor')).toContain('"㈱"\tU+3231\t2');
});
