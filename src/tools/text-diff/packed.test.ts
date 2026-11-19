/** 検査の対象：packed.ts・preview.ts・calculation.ts。改行・無視する条件・折りたたみ・展開・表示上限を組み合わせる。 */
import { expect, it } from 'vitest';
import { diffText } from './logic';
import { packRows } from './packed';
import { splitPreview, unifiedPreview } from './preview';
import { visibleRows, unifiedDisplayRows, foldRows } from './rowReference.testing';
import { calculateDiff } from './calculation';
import { toUnified } from './unified';

it('圧縮した結果を構造化複製しても、表示と全文パッチを参照実装と同じに保つ', () => {
  const inputs = ['', 'a', 'a\nb\n', 'A\r\nb\rc\n', '\n\r\r\n', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'A\nb \nx\nd\ne\nf\ng\nh\ni\nz'];
  for (const before of inputs) for (const after of inputs) {
    for (const ignoreWhitespace of [false, true]) for (const ignoreCase of [false, true]) {
      const options = { ignoreWhitespace, ignoreCase };
      const result = diffText(before, after, options);
      const packed = structuredClone(packRows(result.rows, before, after));
      expect(calculateDiff({ input: before, after, ...options }).unified).toBe(toUnified(result));
      for (const onlyChanges of [false, true]) for (const context of [0, 3]) {
        const folds = foldRows(result.rows, context).flatMap((r) => r.kind === 'fold' ? [r.from] : []);
        for (const expanded of [[], folds]) for (const limit of [0, 1, 3, 100]) {
          const settings = { onlyChanges, context, expanded, limit };
          const expected = visibleRows(result.rows, settings);
          const unified = unifiedDisplayRows(expected);
          expect(splitPreview(packed, settings)).toEqual({ shown: expected.slice(0, limit), total: expected.length });
          expect(unifiedPreview(packed, settings)).toEqual({ shown: unified.slice(0, limit), total: unified.length });
        }
      }
    }
  }
});

it('10万行の不変部分は1範囲にまとめ、展開しても表示する行だけを復元する', () => {
  const text = 'a\r\n'.repeat(100_000);
  const result = calculateDiff({ input: text, after: text, ignoreWhitespace: false, ignoreCase: false });
  expect(result.rows.blocks).toHaveLength(1);
  const options = { onlyChanges: true, context: 3, expanded: [0], limit: 1000 };
  const preview = splitPreview(result.rows, options);
  expect(preview.total).toBe(100_001);
  expect(preview.shown).toHaveLength(1000);
  expect(preview.shown[999]).toMatchObject({ left: { no: 1000, text: 'a', crlf: true } });
});

it('交互変更では入力全体を重ねて持たず、全行の本文と行番号を復元できる', () => {
  const before = Array.from({ length: 1000 }, (_, i) => `元の行${i}`);
  const after = before.map((line, i) => i % 2 ? line : `新しい行${i}`);
  const packed = structuredClone(packRows(diffText(before.join('\n'), after.join('\n'), { ignoreCase: false, ignoreWhitespace: false }).rows, before.join('\n'), after.join('\n')));
  expect(packed.before).toBe('');
  expect(packed.after).toBe('');
  const restored = splitPreview(packed, { onlyChanges: false, context: 0, expanded: [], limit: 2000 });
  for (const [side, original] of [['left', before], ['right', after]] as const) {
    const lines = restored.shown.flatMap((row) => row.kind !== 'fold' && row[side] ? [row[side]!] : []);
    expect(lines.map((line) => line.text)).toEqual(original);
    expect(lines.map((line) => line.no)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
  }
});
