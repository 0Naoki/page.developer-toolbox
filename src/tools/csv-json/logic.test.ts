import { describe, expect, it } from 'vitest';
import { DEFAULT_CSV_TO_JSON, csvToJson, inferValue, uniqueHeaders } from './logic';
import { parseCsv } from './parseCsv';

describe('inferValue', () => {
  it('型を推定する', () => {
    expect(inferValue('42')).toBe(42);
    expect(inferValue('-1.5')).toBe(-1.5);
    expect(inferValue('true')).toBe(true);
    expect(inferValue('null')).toBe(null);
  });

  it('先頭0や大きすぎる数値は文字列のまま', () => {
    expect(inferValue('0123')).toBe('0123');
    expect(inferValue('1000001')).toBe(1000001);
    expect(inferValue('12345678901234567890')).toBe('12345678901234567890');
    expect(inferValue('1,000')).toBe('1,000');
  });

  it('安全な整数の範囲外は、表記が往復しても文字列のまま', () => {
    expect(inferValue('9007199254740991')).toBe(9007199254740991);
    expect(inferValue('-9007199254740991')).toBe(-9007199254740991);
    expect(inferValue('9007199254740992')).toBe('9007199254740992');
    expect(inferValue('-9007199254740992')).toBe('-9007199254740992');
    /** 表記上は往復するため、以前は数値になっていた値 */
    expect(String(Number('1000000000000000100'))).toBe('1000000000000000100');
    expect(inferValue('1000000000000000100')).toBe('1000000000000000100');
  });
});

describe('csvToJson', () => {
  it('1行目を項目名にする', () => {
    const r = csvToJson('id,name,zip\n1,山田,0010001\n2,"佐藤, 花子",1000001', DEFAULT_CSV_TO_JSON);
    expect(JSON.parse(r.json)).toEqual([
      { id: 1, name: '山田', zip: '0010001' },
      { id: 2, name: '佐藤, 花子', zip: 1000001 },
    ]);
    expect(r.rows).toBe(2);
  });

  it('変換後のJSONを読み直しても、整数の値が変わらない', () => {
    const ids = ['9007199254740991', '9007199254740992', '1000000000000000100', '12345678901234567890'];
    const r = csvToJson(`id\n${ids.join('\n')}`, DEFAULT_CSV_TO_JSON);
    const parsed = (JSON.parse(r.json) as { id: number | string }[]).map(({ id }) => id);
    expect(parsed.map((id) => BigInt(id).toString())).toEqual(ids);
    expect(parsed.map((id) => typeof id)).toEqual(['number', 'string', 'string', 'string']);
  });

  it('項目名なし・型変換なし', () => {
    const r = csvToJson('1,2\n3,4', { ...DEFAULT_CSV_TO_JSON, header: false, inferTypes: false });
    expect(JSON.parse(r.json)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('列数の不一致と重複項目名を警告する', () => {
    const r = csvToJson('a,a\n1,2,3', DEFAULT_CSV_TO_JSON);
    expect(JSON.parse(r.json)).toEqual([{ a: 1, a_2: 2, column3: 3 }]);
    expect(r.warnings.length).toBe(2);
  });

  it('重複名の付け方', () => {
    expect(uniqueHeaders(['x', 'x', '', 'x'])).toEqual(['x', 'x_2', 'column3', 'x_3']);
  });
});

describe('値を変えない型変換', () => {
  it('元の表記に戻らない数値は文字列のまま', () => {
    expect(['100.00', '1.10', '1e5', '-0', '0.50'].map(inferValue)).toEqual(['100.00', '1.10', '1e5', '-0', '0.50']);
    expect(['100', '1.1', '-3', '0', '0.5'].map(inferValue)).toEqual([100, 1.1, -3, 0, 0.5]);
  });

  it('CSV→JSON で金額の小数点以下が消えない', () => {
    expect(JSON.parse(csvToJson('price\n1000.00', DEFAULT_CSV_TO_JSON).json)).toEqual([{ price: '1000.00' }]);
  });
});

describe('区切り後の空白', () => {
  it('オフ（既定）のときは値を変えず、疑わしい場合に警告する', () => {
    expect(parseCsv('a, b')).toEqual([['a', ' b']]);
    const r = csvToJson('x,y\n1, "2,3"', DEFAULT_CSV_TO_JSON);
    expect(r.warnings.some((w) => w.includes('区切り後の空白を無視'))).toBe(true);
    const fixed = csvToJson('x,y\n1, "2,3"', { ...DEFAULT_CSV_TO_JSON, skipInitialSpace: true });
    expect(JSON.parse(fixed.json)).toEqual([{ x: 1, y: '2,3' }]);
  });
});

describe('項目名の衝突', () => {
  it('連番が元の項目名と衝突しない', () => {
    expect(uniqueHeaders(['a', 'a', 'a_2'])).toEqual(['a', 'a_3', 'a_2']);
    expect(uniqueHeaders(['a_2', 'a', 'a'])).toEqual(['a_2', 'a', 'a_3']);
    expect(uniqueHeaders(['column2', ''])).toEqual(['column2', 'column2_2']);
    expect(JSON.parse(csvToJson('a,a,a_2\n1,2,3', DEFAULT_CSV_TO_JSON).json)).toEqual([{ a: 1, a_3: 2, a_2: 3 }]);
  });

  it('同じ名前が大量にあっても連番を付けられる', () => {
    const r = uniqueHeaders(Array(100_000).fill('x'));
    expect(new Set(r).size).toBe(100_000);
    expect(r[99_999]).toBe('x_100000');
  });
});

describe('末尾の引用された空フィールド', () => {
  it('末尾の改行の有無で結果が変わらない', () => {
    expect(parseCsv('h\n""')).toEqual([['h'], ['']]);
    const o = { ...DEFAULT_CSV_TO_JSON, skipEmptyLines: false };
    expect(JSON.parse(csvToJson('h\n""', o).json)).toEqual([{ h: '' }]);
    expect(csvToJson('h\n""', o).json).toBe(csvToJson('h\n""\n', o).json);
  });
});

describe('1列の CSV の空のセル', () => {
  it('引用されていない本当の空行は読み飛ばす', () => {
    const o = DEFAULT_CSV_TO_JSON;
    expect(JSON.parse(csvToJson('h\n\n""\n\r\n"x"\n\n', o).json)).toEqual([{ h: '' }, { h: 'x' }]);
    expect(JSON.parse(csvToJson('h\n\n1', { ...o, skipEmptyLines: false }).json)).toEqual([{ h: '' }, { h: 1 }]);
    expect(parseCsv('h\n   \n1', ',', { skipInitialSpace: true, skipEmptyLines: true })).toEqual([['h'], ['1']]);
  });
});

describe('大きなデータ（Math.max の引数の上限）', () => {
  const ROWS = 500_000;

  it('50万行の CSV を JSON に変換できる', () => {
    const csv = `id,name\n${'1,a\n'.repeat(ROWS)}`;
    const withHeader = csvToJson(csv, DEFAULT_CSV_TO_JSON);
    expect(withHeader.rows).toBe(ROWS);
    expect(withHeader.columns).toBe(2);
    const noHeader = csvToJson(csv, { ...DEFAULT_CSV_TO_JSON, header: false });
    expect(noHeader.rows).toBe(ROWS + 1);
    expect(noHeader.columns).toBe(2);
  }, 60_000);
});

describe('CSVへの展開量の制限', () => {
  it('長い項目名が各行へ展開されるJSONは、文字列の生成中に上限で止める', () => {
    const csv = 'x'.repeat(40_000) + '\n' + '1\n'.repeat(1000);
    expect(() => csvToJson(csv, DEFAULT_CSV_TO_JSON)).toThrow('変換結果が大きすぎます');
  });

  it.each([0, 2, 4])('インデント%iのJSON出力をJSON.stringifyと一致させる', (indent) => {
    const result = csvToJson('id,name\n1,a\n2,b', { ...DEFAULT_CSV_TO_JSON, indent });
    expect(result.json).toBe(JSON.stringify([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], null, indent));
  });
});

describe('列の順番を保つ', () => {
  it('字下げと、特別な意味を持つ項目名', () => {
    const { json } = csvToJson('2,__proto__,"a""b"\n1,null,c', { ...DEFAULT_CSV_TO_JSON, indent: 2 });
    expect(json).toBe('[\n  {\n    "2": 1,\n    "__proto__": null,\n    "a\\"b": "c"\n  }\n]');
  });
});

describe('閉じたダブルクォートの後の文字', () => {
  it('値を黙って変えず、行と列を示してエラーにする', () => {
    expect(() => csvToJson('value\n"abc"def', DEFAULT_CSV_TO_JSON)).toThrow('2行6列目：閉じたダブルクォートの後に「d」があります');
    expect(() => parseCsv('"x" ,y')).toThrow('1行4列目：閉じたダブルクォートの後に「 」があります');
    expect(() => parseCsv('"a\nb"c')).toThrow('2行3列目');
  });
});
