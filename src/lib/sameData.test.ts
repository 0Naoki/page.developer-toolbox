import { describe, expect, it } from 'vitest';
import { sameData } from './sameData';

describe('sameData', () => {
  it('作り直した計算の要求（入れ子の設定・配列を含む）は、中身が同じなら同じとする', () => {
    const input = 'a'.repeat(1000);
    const make = () => ({ tool: 'csv', input, direction: 'csv2json', csvOptions: { delimiter: ',', header: true, columns: ['a', 'b'] } });
    expect(sameData(make(), make())).toBe(true);
    expect(sameData(null, null)).toBe(true);
    expect(sameData(Number.NaN, Number.NaN)).toBe(true);
  });

  it('値・キー・要素の数が1つでも違えば、違うとする', () => {
    const base = { tool: 'json', input: 'x', indent: 2, sortKeys: false, list: [1, 2] };
    for (const other of [
      { ...base, input: 'y' },
      { ...base, indent: '2' },
      { ...base, sortKeys: undefined },
      { ...base, list: [1, 2, 3] },
      { ...base, list: [2, 1] },
      { ...base, extra: 1 },
      { tool: 'json', input: 'x', indent: 2, sortKeys: false },
    ]) {
      expect(sameData(base, other), JSON.stringify(other)).toBe(false);
      expect(sameData(other, base), JSON.stringify(other)).toBe(false);
    }
    expect(sameData({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameData([1], { 0: 1 })).toBe(false);
    expect(sameData(null, {})).toBe(false);
    expect(sameData(0, -0)).toBe(false);
  });

  it('配列と普通のオブジェクト以外（Uint8Array・クラスのインスタンス・関数）は参照で比べ、中身が同じでも別の値なら違うとする', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(sameData({ der: bytes }, { der: bytes })).toBe(true);
    expect(sameData({ der: bytes }, { der: new Uint8Array([1, 2, 3]) })).toBe(false);
    expect(sameData(new Date(0), new Date(0))).toBe(false);
    const run = () => 1;
    expect(sameData({ run }, { run })).toBe(true);
    expect(sameData({ run }, { run: () => 1 })).toBe(false);
  });

  it('深すぎる入れ子・循環する値でも止まらず、違うとする（計算をやり直すだけで、古い結果は返さない）', () => {
    const nest = (depth: number): unknown => (depth === 0 ? 'leaf' : { child: nest(depth - 1) });
    expect(sameData(nest(10), nest(10))).toBe(true);
    expect(sameData(nest(40), nest(40))).toBe(false);
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    expect(sameData(a, b)).toBe(false);
  });
});
