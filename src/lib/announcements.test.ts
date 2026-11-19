import { describe, expect, it } from 'vitest';
import { PendingAnnouncements } from './announcements';

describe('PendingAnnouncements', () => {
  it('読み上げる前に消えたエラーは読まず、ほかの表示中のエラーは残す', () => {
    const pending = new PendingAnnouncements();
    const month = Symbol('month');
    const other = Symbol('other');
    pending.set(month, '月は1〜12で入力してください');
    pending.set(other, '日付の形式が違います');
    /** 800ミリ秒より前に、有効な値に直した */
    pending.cancel(month);
    expect(pending.take()).toEqual(['日付の形式が違います']);
    expect(pending.take()).toEqual([]);
  });

  it('同じ表示の文言が変わったときは、最新の文言だけを読む', () => {
    const pending = new PendingAnnouncements();
    const field = Symbol('field');
    pending.set(field, '途中の入力のエラー');
    pending.set(field, '最後の入力のエラー');
    expect(pending.take()).toEqual(['最後の入力のエラー']);
  });

  it('別の表示の同じ文言は1回だけ読む', () => {
    const pending = new PendingAnnouncements();
    pending.set(Symbol('a'), '同じエラー');
    pending.set(Symbol('b'), '同じエラー');
    expect(pending.take()).toEqual(['同じエラー']);
  });
});
