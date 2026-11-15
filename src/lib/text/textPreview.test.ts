import { describe, expect, it } from 'vitest';
import { DETAIL_PREVIEW_LIMIT, MESSAGE_LIMIT, detailPreview, limitMessage } from './textPreview';

describe('detailPreview', () => {
  it('上限以下はそのまま返し、超えたら「…」を含めて上限の長さにする', () => {
    expect(detailPreview('a'.repeat(DETAIL_PREVIEW_LIMIT))).toBe('a'.repeat(DETAIL_PREVIEW_LIMIT));
    const long = detailPreview('a'.repeat(1_000_000));
    expect(long).toBe('a'.repeat(DETAIL_PREVIEW_LIMIT - 1) + '…');
    expect(long).toHaveLength(DETAIL_PREVIEW_LIMIT);
    expect(detailPreview('')).toBe('');
  });

  it('サロゲートペアの途中で切らない', () => {
    const text = 'a'.repeat(DETAIL_PREVIEW_LIMIT - 2) + '😀' + 'b';
    expect(detailPreview(text)).toBe('a'.repeat(DETAIL_PREVIEW_LIMIT - 2) + '…');
  });
});

describe('limitMessage', () => {
  it('上限以下の文言はそのまま、超えたら「…」を含めて上限の長さにする', () => {
    expect(limitMessage('2行5列目：値がありません')).toBe('2行5列目：値がありません');
    expect(limitMessage('a'.repeat(MESSAGE_LIMIT))).toHaveLength(MESSAGE_LIMIT);
    const long = limitMessage(`「${'x'.repeat(1_000_000)}」は読めません`);
    expect(long).toHaveLength(MESSAGE_LIMIT);
    expect(long.endsWith('…')).toBe(true);
  });
});
