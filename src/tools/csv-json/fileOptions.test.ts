import { describe, expect, it } from 'vitest';
import { optionsForFile, optionsForSwap } from './fileOptions';
import { csvToJson, DEFAULT_CSV_TO_JSON } from './logic';
import { DEFAULT_JSON_TO_CSV, jsonToCsv } from './writeCsv';

describe('入れ替えの後の変換設定', () => {
  it('元の向きの区切り文字を、移る先の向きに引き継ぐ', () => {
    expect(optionsForSwap('json2csv', { csv2json: ',', json2csv: '\t' })).toEqual({ direction: 'csv2json', delimiter: '\t' });
    expect(optionsForSwap('csv2json', { csv2json: ';', json2csv: ',' })).toEqual({ direction: 'json2csv', delimiter: ';' });
    expect(optionsForSwap('csv2json', { csv2json: '|', json2csv: '|' })).toEqual({ direction: 'json2csv', delimiter: '|' });
  });

  it('回帰：タブ区切りで書いた CSV を入れ替えると、1列ではなく元の JSON に戻る', () => {
    const { csv } = jsonToCsv('[{"a":1,"b":2}]', { ...DEFAULT_JSON_TO_CSV, delimiter: '\t' });
    const next = optionsForSwap('json2csv', { csv2json: DEFAULT_CSV_TO_JSON.delimiter, json2csv: '\t' });
    expect(JSON.parse(csvToJson(csv, { ...DEFAULT_CSV_TO_JSON, delimiter: next.delimiter }).json)).toEqual([{ a: 1, b: 2 }]);
  });
});

describe('ファイル名からの変換設定', () => {
  const current = { direction: 'json2csv', delimiter: ';' } as const;
  it('本当の拡張子だけを読み、大小文字と複数のドットを受け付ける', () => {
    expect(optionsForFile('report.2026.CSV', current)).toEqual({ direction: 'csv2json', delimiter: ',' });
    expect(optionsForFile('report.TsV', current)).toEqual({ direction: 'csv2json', delimiter: '\t' });
    expect(optionsForFile('report.JSON', { direction: 'csv2json', delimiter: '\t' })).toEqual({ direction: 'json2csv', delimiter: '\t' });
    expect(optionsForFile('report.txt', current)).toEqual({ direction: 'csv2json', delimiter: ';' });
  });
  it('拡張子なし・未知の拡張子・拡張子のような末尾では設定を変えない', () => {
    for (const name of ['', 'report-json', 'report-tsv', 'report-csv', 'report-txt', 'report.csv.bak', 'report.atsv', 'report.']) {
      expect(optionsForFile(name, current), name).toEqual(current);
    }
  });
});
