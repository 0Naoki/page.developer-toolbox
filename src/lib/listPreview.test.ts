import { describe, expect, it } from 'vitest';
import { LIST_PREVIEW_LIMIT, previewList } from './listPreview';

describe('一覧の表示の上限', () => {
  it('上限以内なら全件を表示し、残りは0件', () => {
    const items = [1, 2, 3];
    expect(previewList(items, 3)).toEqual({ shown: items, rest: 0 });
    expect(previewList([], 3)).toEqual({ shown: [], rest: 0 });
  });

  it('上限を超えると先頭だけを表示し、残りの件数を返す', () => {
    const items = Array.from({ length: LIST_PREVIEW_LIMIT + 1 }, (_, i) => i);
    const { shown, rest } = previewList(items);
    expect(shown).toHaveLength(LIST_PREVIEW_LIMIT);
    expect(shown.at(-1)).toBe(LIST_PREVIEW_LIMIT - 1);
    expect(rest).toBe(1);
  });

  it('先頭だけが届いた一覧（Worker の結果など）は、全件の数から残りを数える', () => {
    expect(previewList(['a', 'b'], 2, 35_000)).toEqual({ shown: ['a', 'b'], rest: 34_998 });
  });
});
