import { describe, expect, it } from 'vitest';
import { cloudSubnetNotes } from './cloudPolicy';

describe('クラウドごとのサブネットサイズの案内', () => {
  for (const [family, prefixes, aws, azure] of [
    [4, [1, 2, 15, 16, 28, 29, 30], [16, 28], [2, 15, 16, 28, 29]],
    [6, [40, 44, 45, 48, 60, 64, 68], [44, 48, 60, 64], [64]],
  ] as const) {
    for (const prefix of prefixes) {
      it(`IPv${family} /${prefix} の予約数と両サービスの条件を分ける`, () => {
        const notes = cloudSubnetNotes(family, prefix);
        expect(notes[0]).toContain('先頭4つと末尾1つ');
        expect(notes[1]?.includes('対象外')).toBe(!(aws as readonly number[]).includes(prefix));
        expect(notes[2]?.includes('対象外')).toBe(!(azure as readonly number[]).includes(prefix));
      });
    }
  }
});
