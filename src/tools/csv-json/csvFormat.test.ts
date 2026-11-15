import { describe, expect, it } from 'vitest';
import { maxColumns } from './csvFormat';

describe('大きなデータ（Math.max の引数の上限）', () => {

  it('最大の列数をループで求める', () => {
    expect(maxColumns([])).toBe(0);
    expect(maxColumns([[1], [1, 2, 3], [1, 2]])).toBe(3);
    expect(maxColumns([[1]], 4)).toBe(4);
  });
});
