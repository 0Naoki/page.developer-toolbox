import { describe, expect, it } from 'vitest';
import { optionsForFile } from './fileOptions';

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
