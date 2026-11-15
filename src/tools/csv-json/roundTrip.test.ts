import { describe, expect, it } from 'vitest';
import { DEFAULT_CSV_TO_JSON, csvToJson } from './logic';
import { DEFAULT_JSON_TO_CSV, jsonToCsv } from './writeCsv';

describe('csvToJson', () => {
  it('項目名の前後の空白を残し、JSON→CSV→JSON で項目名が変わらない', () => {
    expect(JSON.parse(csvToJson('" id ",x\n001,1', DEFAULT_CSV_TO_JSON).json)).toEqual([{ ' id ': '001', x: 1 }]);
    const csv = jsonToCsv('[{" id ":"001","id":"002"}]', DEFAULT_JSON_TO_CSV).csv;
    const back = csvToJson(csv, DEFAULT_CSV_TO_JSON);
    expect(JSON.parse(back.json)).toEqual([{ ' id ': '001', id: '002' }]);
    expect(back.warnings).toEqual([]);
  });
});

describe('jsonToCsv', () => {
  const opts = { ...DEFAULT_JSON_TO_CSV, newline: '\n' as const };

  it('往復しても値が変わらない', () => {
    const csv = 'id,name\n1,"改行\nあり"\n2,"""引用"""';
    const back = jsonToCsv(csvToJson(csv, DEFAULT_CSV_TO_JSON).json, opts).csv;
    expect(back).toBe(csv);
  });
});

describe('1列の CSV の空のセル', () => {
  it('JSON → CSV で空のセルを "" と書き、CSV → JSON で行が消えない', () => {
    const json = '[{"a":"x"},{"a":""},{"a":null},{"a":"y"}]';
    const { csv } = jsonToCsv(json, DEFAULT_JSON_TO_CSV);
    expect(csv).toBe('a\r\nx\r\n""\r\n""\r\ny');
    expect(JSON.parse(csvToJson(csv, DEFAULT_CSV_TO_JSON).json)).toEqual([{ a: 'x' }, { a: '' }, { a: '' }, { a: 'y' }]);
  });
});

describe('列の順番を保つ', () => {
  it('整数に見える項目名も、書かれた順のまま出力する', () => {
    const { json } = csvToJson('name,2024,2023\nx,1,2', { ...DEFAULT_CSV_TO_JSON, indent: 0 });
    expect(json).toBe('[{"name":"x","2024":1,"2023":2}]');
    expect(jsonToCsv(json, DEFAULT_JSON_TO_CSV).csv).toBe('name,2024,2023\r\nx,1,2');
  });
});
