import { describe, expect, it } from 'vitest';
import { DEFAULT_JSON_TO_CSV, jsonToCsv, neutralizeFormula } from './writeCsv';
import { parseCsv } from './parseCsv';

describe('CSV の UTF-8 出力境界', () => {
  it('復号後の不完全なサロゲートを、出力する行・列を示して拒否する', () => {
    for (const char of ['\uD800', '\uDC00']) {
      expect(() => jsonToCsv(JSON.stringify([{ value: char }]), DEFAULT_JSON_TO_CSV)).toThrow(/2行1列目.*サロゲート.*UTF-8/);
      expect(() => jsonToCsv(JSON.stringify([{ [char]: 'ok' }]), DEFAULT_JSON_TO_CSV)).toThrow(/1行1列目.*サロゲート.*UTF-8/);
      expect(() => jsonToCsv(JSON.stringify([['ok', char]]), DEFAULT_JSON_TO_CSV)).toThrow(/1行2列目.*サロゲート.*UTF-8/);
    }
  });

  it('正常なペア・文字としてのエスケープ・入れ子のJSONを保存しても値を変えない', async () => {
    const input = JSON.stringify([{ name: '😀', raw: '\\ud800', nested: ['\uD800'] }]);
    const result = jsonToCsv(input, DEFAULT_JSON_TO_CSV);
    expect(await new Blob([result.csv]).text()).toBe(result.csv);
    expect(parseCsv(result.csv)).toEqual([['name', 'raw', 'nested'], ['😀', '\\ud800', '["\\ud800"]']]);
    const withoutHeader = jsonToCsv(JSON.stringify([{ ['\uD800']: 'ok' }]), { ...DEFAULT_JSON_TO_CSV, header: false });
    expect(withoutHeader.csv).toBe('ok');
  });
});

describe('jsonToCsv', () => {
  it('重なった長い項目名は、エラーに抜粋だけを入れる', () => {
    const key = 'k'.repeat(1_000_000);
    expect(() => jsonToCsv(`[{"${key}.a":1,"${key}":{"a":2}}]`, DEFAULT_JSON_TO_CSV)).toThrow(new RegExp(`^項目名「k{255}…」が重複しています`));
  });

  it('0列の行を空行として出力しない', () => {
    expect(() => jsonToCsv('[[1],[],[2]]', DEFAULT_JSON_TO_CSV)).toThrow('2行目に列がありません');
    expect(() => jsonToCsv('[{},{}]', DEFAULT_JSON_TO_CSV)).toThrow('1行目に列がありません');
    expect(jsonToCsv('[]', DEFAULT_JSON_TO_CSV).csv).toBe('');
  });

  const opts = { ...DEFAULT_JSON_TO_CSV, newline: '\n' as const };

  it('オブジェクトの配列を変換し、必要な値だけクォートする', () => {
    const r = jsonToCsv('[{"id":1,"name":"a,b"},{"id":2,"memo":"say \\"hi\\""}]', opts);
    expect(r.csv).toBe('id,name,memo\n1,"a,b",\n2,,"say ""hi"""');
  });

  it('入れ子を展開する', () => {
    const json = '[{"user":{"name":"山田","tags":["a","b"]},"ok":true,"x":null}]';
    expect(jsonToCsv(json, opts).csv).toBe('user.name,user.tags,ok,x\n山田,"[""a"",""b""]",true,');
    expect(jsonToCsv(json, { ...opts, flatten: false }).csv.split('\n')[0]).toBe('user,ok,x');
  });

  it('配列の配列・単一オブジェクト', () => {
    expect(jsonToCsv('[[1,2],[3,"x y"]]', opts).csv).toBe('1,2\n3,x y');
    expect(jsonToCsv('{"a":1}', opts).csv).toBe('a\n1');
  });

  it('すべてクォート・CRLF', () => {
    expect(jsonToCsv('[{"a":1}]', { ...DEFAULT_JSON_TO_CSV, quoteAll: true }).csv).toBe('"a"\r\n"1"');
  });

  it('不正なJSONはエラー', () => {
    expect(() => jsonToCsv('{', opts)).toThrow();
    expect(() => jsonToCsv('"text"', opts)).toThrow();
  });
});

describe('CSV インジェクション対策', () => {
  const opts = { ...DEFAULT_JSON_TO_CSV, newline: '\n' as const };

  it('数式になる文字列の先頭に \' を付ける', () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil","x")')).toBe('\'=HYPERLINK("http://evil","x")');
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeFormula('+1+1')).toBe("'+1+1");
    expect(neutralizeFormula('-5')).toBe('-5');
    for (const value of ['＝1+1', '＋1', '－1', '＠SUM(A1)', '\n=1+1', '\t=1+1', '\r=1+1']) {
      expect(neutralizeFormula(value), value).toBe(`'${value}`);
    }
    expect(neutralizeFormula('普通の値')).toBe('普通の値');
    expect(neutralizeFormula('-1.5e3')).toBe('-1.5e3');
    expect(neutralizeFormula('+5.')).toBe('+5.');
    expect(neutralizeFormula('-.5')).toBe('-.5');
    /** USAGE の数式インジェクション対策の説明に挙げた例 */
    for (const value of ['-5', '+1.5', '-1.5e3', '-.5']) expect(neutralizeFormula(value), value).toBe(value);
    expect(neutralizeFormula('－5')).toBe("'－5");
  });

  it('長い数字の後に数値でない文字があっても、すぐに判定が終わる', () => {
    const value = `-${'1'.repeat(150_000)}x`;
    const start = performance.now();
    expect(neutralizeFormula(value)).toBe(`'${value}`);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('JSON→CSV の既定で有効、数値型は対象外、オフにもできる', () => {
    const json = '[{"name":"=1+1","n":-5}]';
    expect(jsonToCsv(json, opts).csv).toBe("name,n\n'=1+1,-5");
    expect(jsonToCsv(json, { ...opts, escapeFormulas: false }).csv).toBe('name,n\n=1+1,-5');
  });
});

describe('JSON→CSV で数値の表記を保つ', () => {
  const opts = { ...DEFAULT_JSON_TO_CSV, newline: '\n' as const };

  it('大きな整数・小数の桁・指数表記を丸めない', () => {
    const r = jsonToCsv('[{"id":9007199254740993,"price":100.00,"n":1e400,"z":-0}]', opts);
    expect(r.csv).toBe('id,price,n,z\n9007199254740993,100.00,1e400,-0');
  });

  it('入れ子の配列・オブジェクトの中の数値も元の表記のまま', () => {
    expect(jsonToCsv('[{"x":{"a":1.10},"y":[1.0,2e3]}]', { ...opts, flatten: false }).csv).toBe(
      'x,y\n"{""a"":1.10}","[1.0,2e3]"',
    );
    expect(jsonToCsv('[[12345678901234567890,"a"]]', opts).csv).toBe('12345678901234567890,a');
  });

  it('文字列のエスケープは展開して出す', () => {
    expect(jsonToCsv('[{"s":"\\u3042\\n"}]', opts).csv).toBe('s\n"あ\n"');
  });

  it('構文エラーは位置を示す', () => {
    expect(() => jsonToCsv('[{"a":1,}]', opts)).toThrow(/1行9列目/);
    /** BOM は位置に数えない */
    expect(() => jsonToCsv('﻿[{"a":1,}]', opts)).toThrow(/1行9列目/);
    expect(() => jsonToCsv('[\n  {"a":1,}\n]', opts)).toThrow(/2行10列目/);
  });
});

describe('項目名の衝突', () => {
  it('フラット化で同じ列名になる場合はエラーにする', () => {
    const json = '[{"a.b":"first","a":{"b":"second"}}]';
    expect(() => jsonToCsv(json, DEFAULT_JSON_TO_CSV)).toThrow(/a\.b/);
    expect(jsonToCsv(json, { ...DEFAULT_JSON_TO_CSV, flatten: false, newline: '\n' }).csv).toBe(
      'a.b,a\nfirst,"{""b"":""second""}"',
    );
  });

  it('空文字のキーの下の項目も親の名前を付けて展開する', () => {
    const o = { ...DEFAULT_JSON_TO_CSV, newline: '\n' as const };
    expect(jsonToCsv('[{"":{"b":1},"b":2}]', o).csv).toBe('.b,b\n1,2');
    expect(jsonToCsv('[{"a":{"":{"b":1}}}]', o).csv).toBe('a..b\n1');
  });

  it('重複したキーは黙って片方を捨てずにエラーにする', () => {
    expect(() => jsonToCsv('[{"a":1,"a":2}]', DEFAULT_JSON_TO_CSV)).toThrow(/「a」/);
  });
});

describe('1列の CSV の空のセル', () => {
  it('配列の配列でも同じ', () => {
    expect(jsonToCsv('[["x"],[""],["y"]]', DEFAULT_JSON_TO_CSV).csv).toBe('x\r\n""\r\ny');
  });

  it('2列以上の空のセルは今までどおり引用しない', () => {
    expect(jsonToCsv('[{"a":"","b":""}]', DEFAULT_JSON_TO_CSV).csv).toBe('a,b\r\n,');
  });
});

describe('大きなデータ（Math.max の引数の上限）', () => {
  const ROWS = 500_000;

  it('50万行の配列の配列を CSV に変換できる', () => {
    const json = `[${Array(ROWS).fill('[1,2]').join(',')}]`;
    const r = jsonToCsv(json, DEFAULT_JSON_TO_CSV);
    expect(r.rows).toBe(ROWS);
    expect(r.columns).toBe(2);
  });
});

describe('CSVへの展開量の制限', () => {
  it('小さいJSONでも、行数と全列数の積が大きい場合は展開前に拒否する', () => {
    const input = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ [`k${i}`]: i })));
    expect(() => jsonToCsv(input, DEFAULT_JSON_TO_CSV)).toThrow('セル数');
  });

  it('上限内の疎なJSONは値を保って変換する', () => {
    const input = '[{"a":1},{"b":2}]';
    expect(jsonToCsv(input, DEFAULT_JSON_TO_CSV).csv).toBe('a,b\r\n1,\r\n,2');
  });
});
