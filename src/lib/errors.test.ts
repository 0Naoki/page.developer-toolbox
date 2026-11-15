import { describe, expect, it } from 'vitest';
import { attempt, errorMessage, UNKNOWN_ERROR } from './errors';

describe('例外の文言', () => {
  it('Error（DOMException などの派生を含む）は message を使う', () => {
    expect(errorMessage(new RangeError('範囲外'))).toBe('範囲外');
    expect(errorMessage(new DOMException('読めません', 'NotReadableError'))).toBe('読めません');
  });

  it('Error 以外は中身を表示せず、決まった文言にする（undefined にしない）', () => {
    for (const thrown of ['入力の一部', { secret: 'x' }, undefined, null, 1, Symbol('s'), Object.create(null)]) {
      expect(errorMessage(thrown)).toBe(UNKNOWN_ERROR);
    }
    expect(errorMessage('x', '計算できませんでした。')).toBe('計算できませんでした。');
  });
});

describe('描画中の計算', () => {
  it('成功すると戻り値のプロパティを ok と並べる', () => {
    expect(attempt(() => ({ value: 1, info: 'a' }))).toEqual({ ok: true, value: 1, info: 'a' });
    /** 戻り値に ok があっても、成功の印で上書きする */
    expect(attempt(() => ({ ok: false }))).toEqual({ ok: true });
  });

  it('例外は表示用の文言にする', () => {
    expect(attempt(() => { throw new Error('読めません'); })).toEqual({ ok: false, error: '読めません' });
    expect(attempt(() => { throw '文字列'; })).toEqual({ ok: false, error: UNKNOWN_ERROR });
  });
});
