import { describe, expect, it } from 'vitest';
import { formatJson } from './logic';

const out = (input: string, indent: Parameters<typeof formatJson>[1] = 2, sort = false) => {
  const r = formatJson(input, indent, sort);
  if (!r.ok) throw new Error(r.error);
  return r.output;
};

describe('formatJson：整形', () => {
  it('JSON.stringify と同じ見た目に整形する', () => {
    expect(out('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    const samples = ['{"x":{"y":[true,false,null,{"z":"日本語"}]},"e":{},"f":[]}', '[[],[{}],"s",-1.5]', '"text"', '0'];
    for (const s of samples) {
      for (const indent of [2, 4, 'tab', 'minify'] as const) {
        const space = indent === 'minify' ? undefined : indent === 'tab' ? '\t' : indent;
        expect(out(s, indent)).toBe(JSON.stringify(JSON.parse(s), null, space));
      }
    }
  });

  it('キーを再帰的にソートし、配列の順序は保つ', () => {
    expect(out('{"b":1,"a":{"d":1,"c":[{"z":1,"y":2}]}}', 'minify', true)).toBe('{"a":{"c":[{"y":2,"z":1}],"d":1},"b":1}');
  });

  it('空入力は空を返す', () => {
    expect(out('   ')).toBe('');
  });
});

describe('formatJson：値を変えない', () => {
  it('大きな整数を丸めない', () => {
    expect(out('{"id":9007199254740993}', 'minify')).toBe('{"id":9007199254740993}');
    expect(out('[12345678901234567890123]', 'minify')).toBe('[12345678901234567890123]');
  });

  it('数値の表記を変えない', () => {
    expect(out('[1.10, 1e2, 1E+2, -0, 0.0]', 'minify')).toBe('[1.10,1e2,1E+2,-0,0.0]');
  });

  it('文字列のエスケープを展開しない', () => {
    expect(out('["\\u3042", "a\\/b", "\\n"]', 'minify')).toBe('["\\u3042","a\\/b","\\n"]');
  });

  it('長い重複キーは、警告に抜粋だけを入れ、出力ではキーを全文保つ', () => {
    const key = 'k'.repeat(1_000_000);
    const r = formatJson(`{"${key}":1,"${key}":2}`, 'minify');
    expect(r.ok && r.output).toBe(`{"${key}":1,"${key}":2}`);
    expect(r.ok && r.warnings).toEqual([`キー「${'k'.repeat(255)}…」が重複しています（1行目）`]);
  });

  it('重複したキーを消さずに警告する', () => {
    const r = formatJson('{"a":1,\n"a":2}', 'minify');
    expect(r.ok && r.output).toBe('{"a":1,"a":2}');
    expect(r.ok && r.warnings).toEqual(['キー「a」が重複しています（2行目）']);
  });

  it('入れ子の中の重複も、それぞれの行番号で警告する', () => {
    const r = formatJson('{"a":1,\n"b":{"x":1,\n\n"x":2},\n"a":3}');
    expect(r.ok && r.warnings).toEqual(['キー「x」が重複しています（4行目）', 'キー「a」が重複しています（5行目）']);
  });

  it('重複したキーが大量にあっても時間がかからない', () => {
    /** 重複のたびに先頭から行数を数える実装では、4万件で40秒かかる */
    const n = 40_000;
    const json = `{\n${Array.from({ length: n }, () => '"a": 1').join(',\n')}\n}`;
    const start = performance.now();
    const r = formatJson(json);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(r.ok && r.warnings.length).toBe(n - 1);
    expect(r.ok && r.warnings[n - 2]).toBe(`キー「a」が重複しています（${n + 1}行目）`);
  });

  it('BOM付きでも読める', () => {
    expect(out('﻿{"a":1}', 'minify')).toBe('{"a":1}');
  });
});

describe('formatJson：構文エラーの位置', () => {
  const err = (input: string) => {
    const r = formatJson(input);
    if (r.ok) throw new Error('エラーになるはず');
    return `${r.line}:${r.column} ${r.error}`;
  };

  it('末尾のカンマ', () => {
    expect(err('{\n  "a": 1,\n}')).toBe('3:1 最後の要素の後ろに余分なカンマがあります');
    expect(err('[1,]')).toBe('1:4 最後の要素の後ろに余分なカンマがあります');
  });

  it('クォートのないキー・シングルクォート', () => {
    expect(err('{a:1}')).toBe('1:2 キーはダブルクォートで囲む必要があります');
    expect(err("{\"a\":'x'}")).toBe('1:6 文字列はシングルクォートではなくダブルクォートで囲みます');
  });

  it('閉じていない文字列・途中で終わる入力', () => {
    expect(err('{"a":"abc')).toBe('1:6 文字列が閉じられていません（" が足りません）');
    expect(err('{"a":')).toBe('1:6 値が必要ですが、入力が終わっています');
  });

  it('不正な数値・余分な文字', () => {
    expect(err('[01]')).toMatch(/^1:3 数値の書き方/);
    expect(err('{"a":1} x')).toBe('1:9 JSONの後ろに余分な文字があります');
    expect(err('{"a" 1}')).toBe('1:6 キーの後には「:」が必要ですが、「1」があります');
  });

  it('CR・LF・CRLF のどの改行でも、同じ行と列を示す', () => {
    for (const nl of ['\n', '\r\n', '\r']) {
      expect(err(`{${nl}"a":1,${nl}}`), JSON.stringify(nl)).toBe('3:1 最後の要素の後ろに余分なカンマがあります');
      const r = formatJson(`{${nl}"a":1,${nl}"a":2}`);
      expect(r.ok && r.warnings, JSON.stringify(nl)).toEqual(['キー「a」が重複しています（3行目）']);
    }
    expect(err('{\r\r"a" 1}')).toBe('3:5 キーの後には「:」が必要ですが、「1」があります');
  });

  it('日本語を含む行でも文字数で列を数える', () => {
    expect(err('{"名前": x}')).toBe('1:8 値が必要な位置に「x」があります');
  });

  it('絵文字が原因のエラーでは、絵文字を1文字として表示する', () => {
    expect(err('{"a": 😀}')).toBe('1:7 値が必要な位置に「😀」があります');
    expect(err('[1 😀]')).toBe('1:4 「,」または「]」が必要ですが、「😀」があります');
  });
});
