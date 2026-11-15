import { describe, expect, it } from 'vitest';
import { parseCsv } from './parseCsv';

describe('parseCsv', () => {
  it('クォート内のカンマ・改行・エスケープ', () => {
    expect(parseCsv('a,"b,c","d\n""e"""\r\n1,2,3')).toEqual([
      ['a', 'b,c', 'd\n"e"'],
      ['1', '2', '3'],
    ]);
  });

  it('BOM と末尾の改行を無視する', () => {
    expect(parseCsv('﻿a,b\n')).toEqual([['a', 'b']]);
  });

  it('空のフィールド', () => {
    expect(parseCsv(',a,\n')).toEqual([['', 'a', '']]);
  });

  it('タブ区切り', () => {
    expect(parseCsv('a\tb,c', '\t')).toEqual([['a', 'b,c']]);
  });

  it('閉じていないクォートはエラー', () => {
    expect(() => parseCsv('a,"b\nc')).toThrow();
  });
});

describe('区切り後の空白', () => {
  it('オンにすると「a, "b,c"」を2列として読む', () => {
    expect(parseCsv('a, "b,c"', ',', { skipInitialSpace: true })).toEqual([['a', 'b,c']]);
    expect(parseCsv('a,  b', ',', { skipInitialSpace: true })).toEqual([['a', 'b']]);
  });

  it('タブ区切りではタブを空白として読み飛ばさない', () => {
    expect(parseCsv('a\t\tb', '\t', { skipInitialSpace: true })).toEqual([['a', '', 'b']]);
  });
});

describe('末尾の引用された空フィールド', () => {
  it('引用されていない空の末尾は今までどおり行にしない', () => {
    expect(parseCsv('h\n')).toEqual([['h']]);
    expect(parseCsv('h\n  ', ',', { skipInitialSpace: true })).toEqual([['h']]);
  });
});

describe('閉じたダブルクォートの後の文字', () => {
  it('引用符の中の CR・LF・CRLF を、どれも1つの改行として数える', () => {
    for (const nl of ['\r', '\n', '\r\n']) expect(() => parseCsv(`"a${nl}b"x`), JSON.stringify(nl)).toThrow('2行3列目');
    expect(() => parseCsv('"a\r\rb"x')).toThrow('3行3列目');
    expect(parseCsv('"a\rb"')).toEqual([['a\rb']]);
  });

  it('区切り文字・改行・終わりは続けられる', () => {
    expect(parseCsv('"a","b"\r\n"c"\n"d"')).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});
