import { expect, it } from 'vitest';
import { codePointCount, findLoneSurrogate } from './surrogate';

it('文字数はサロゲートペアを1文字、対になっていないサロゲートも1文字と数え、Array.from と一致する', () => {
  for (const text of ['', 'abc', '日本語', '😀', 'a😀b', '\uD800', '\uDC00', '\uD800\uD800\uDC00', '😀\uD800', '\uDC00😀']) {
    expect(codePointCount(text), JSON.stringify(text)).toBe(Array.from(text).length);
  }
});

it('対になっていないサロゲートの位置を返す', () => {
  expect(findLoneSurrogate('a😀b')).toBe(-1);
  expect(findLoneSurrogate('ab\uD800')).toBe(2);
  expect(findLoneSurrogate('\uDC00a')).toBe(0);
});
