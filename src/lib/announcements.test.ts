import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANNOUNCE_DELAY_MS, Announcer, PendingAnnouncements, PUBLISH_DELAY_MS } from './announcements';

describe('Announcer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    vi.useFakeTimers();
    const shown: string[] = [];
    return { shown, announcer: new Announcer((text) => shown.push(text)) };
  };

  it('入力が止まってから、いったん空にしてまとめて読む。読む前に取り消した文言は読まない', () => {
    const { shown, announcer } = setup();
    const a = Symbol('a');
    const b = Symbol('b');
    announcer.announce(a, 'A');
    announcer.announce(b, 'B');
    announcer.cancel(b);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + PUBLISH_DELAY_MS);
    expect(shown).toEqual(['', 'A']);
  });

  it('回帰：空にしてから文言を入れるまでの間に別の文言が出ても、取り出した文言を失わない', () => {
    const { shown, announcer } = setup();
    announcer.announce(Symbol('a'), 'A');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    expect(shown).toEqual(['']);
    /** A を領域に入れる前に、別の表示から B が出る */
    vi.advanceTimersByTime(PUBLISH_DELAY_MS / 2);
    announcer.announce(Symbol('b'), 'B');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + PUBLISH_DELAY_MS);
    expect(shown).toEqual(['', 'A', '', 'B']);
  });

  it('同時に出た文言は3件までを読み、残りは件数にする', () => {
    const { shown, announcer } = setup();
    for (const text of ['1', '2', '3', '4', '5']) announcer.announce(Symbol(text), text);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + PUBLISH_DELAY_MS);
    expect(shown.at(-1)).toBe('1。2。3。ほか 2 件');
  });

  it('公開待ちの間に取り消した文言だけを除き、同じ文言を出した別の通知元は残す', () => {
    const { shown, announcer } = setup();
    const a = Symbol('a'), b = Symbol('b'), c = Symbol('c');
    announcer.announce(a, 'A');
    announcer.announce(b, '同じ文言');
    announcer.announce(c, '同じ文言');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + PUBLISH_DELAY_MS / 2);
    announcer.cancel(a);
    announcer.cancel(b);
    vi.advanceTimersByTime(PUBLISH_DELAY_MS / 2);
    expect(shown).toEqual(['', '同じ文言']);
  });

  it('公開待ちの間に同じ通知元を更新したら、古い文言を出さず、新しい文言は改めて待って読む', () => {
    const { shown, announcer } = setup();
    const source = Symbol('field');
    announcer.announce(source, '古い文言');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + PUBLISH_DELAY_MS / 2);
    announcer.announce(source, '新しい文言');
    vi.advanceTimersByTime(PUBLISH_DELAY_MS / 2);
    expect(shown).toEqual(['']);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + PUBLISH_DELAY_MS);
    expect(shown).toEqual(['', '', '新しい文言']);
  });

  it('公開待ちのすべての文言を取り消したら、予約済みでも読み上げない', () => {
    const { shown, announcer } = setup();
    const source = Symbol('field');
    announcer.announce(source, '消したエラー');
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
    announcer.cancel(source);
    vi.advanceTimersByTime(PUBLISH_DELAY_MS);
    expect(shown).toEqual(['']);
  });
});

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
