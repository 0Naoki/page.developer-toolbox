import { describe, expect, it } from 'vitest';
import { arrayOf, integerBetween, isBoolean, isString, isValidSetting, oneOf, readSetting } from './settings';
import { DEFAULT_OPTIONS, isPasswordOptions } from '../tools/password-generator/logic';
import { DEFAULT_CSV_TO_JSON, isCsvToJsonOptions } from '../tools/csv-json/logic';
import { DEFAULT_JSON_TO_CSV, isJsonToCsvOptions } from '../tools/csv-json/writeCsv';

describe('保存した表示設定の検証', () => {
  it('壊れたJSON・null・違う型・範囲外の値を既定値へ戻す', () => {
    for (const raw of [null, '{', 'null', '"5"', 'true', '[]', '{}', '0', '100000000', '1.5', '1e999']) {
      expect(readSetting(raw, 5, integerBetween(1, 20))).toBe(5);
    }
    expect(readSetting('10', 5, integerBetween(1, 20))).toBe(10);
    expect(readSetting('false', true, isBoolean)).toBe(false);
    expect(readSetting('"false"', true, isBoolean)).toBe(true);
    expect(readSetting('""', 'default', isString)).toBe('');
    expect(readSetting('"other"', 'split', oneOf('split', 'unified'))).toBe('split');
  });

  it('配列の要素・件数も検証し、空配列を許可する', () => {
    const initial = [0, 6];
    const weekend = arrayOf(integerBetween(0, 6), 7);
    for (const value of ['0,6', [0, '6'], [7], [0.5], Array(8).fill(0), null]) {
      expect(readSetting(JSON.stringify(value), initial, weekend)).toBe(initial);
    }
    expect(readSetting('[]', initial, weekend)).toEqual([]);
    expect(readSetting('[5,6]', initial, weekend)).toEqual([5, 6]);
  });

  it('保存前の検証は、復元時と同じく保存する文字列を読み直して判定する', () => {
    const length = integerBetween(1, 20);
    expect(isValidSetting('10', length)).toBe(true);
    expect(isValidSetting('21', length)).toBe(false);
    /** JSON.stringify(NaN) は "null" になり、復元時に数値ではなくなる */
    expect(isValidSetting(JSON.stringify(Number.NaN), (value: unknown): value is number => typeof value === 'number')).toBe(false);
    expect(isValidSetting('{', isString)).toBe(false);
    const allClassesOff = JSON.stringify({ ...DEFAULT_OPTIONS, upper: false, lower: false, digits: false, symbols: false });
    expect(isValidSetting(allClassesOff, isPasswordOptions)).toBe(false);
    expect(isValidSetting(JSON.stringify(DEFAULT_OPTIONS), isPasswordOptions)).toBe(true);
  });

  it('検証関数が例外を投げても既定値へ戻す', () => {
    expect(readSetting('1', 5, (_value: unknown): _value is number => { throw new Error('invalid'); })).toBe(5);
  });

  it('パスワード設定の全フィールドの型と長さを検証する', () => {
    for (const patch of [
      { length: 3 }, { length: 129 }, { length: '16' }, { length: 4.5 },
      { upper: 'false' }, { lower: 0 }, { digits: null }, { symbols: [] },
      { symbolSet: 123 }, { exclude: {} }, { excludeAmbiguous: 'yes' }, { requireEach: 1 },
      { upper: false, lower: false, digits: false, symbols: false },
    ]) {
      expect(readSetting(JSON.stringify({ ...DEFAULT_OPTIONS, ...patch }), DEFAULT_OPTIONS, isPasswordOptions)).toBe(DEFAULT_OPTIONS);
    }
    expect(readSetting('{"length":16}', DEFAULT_OPTIONS, isPasswordOptions)).toBe(DEFAULT_OPTIONS);
    for (const length of [4, 128]) expect(isPasswordOptions({ ...DEFAULT_OPTIONS, length })).toBe(true);
    expect(readSetting(JSON.stringify({ ...DEFAULT_OPTIONS, length: 24 }), DEFAULT_OPTIONS, isPasswordOptions).length).toBe(24);
  });

  it('CSVの複合設定も型・選択肢・範囲を検証する', () => {
    expect(isCsvToJsonOptions(DEFAULT_CSV_TO_JSON)).toBe(true);
    expect(isJsonToCsvOptions(DEFAULT_JSON_TO_CSV)).toBe(true);
    for (const patch of [{ delimiter: 'x' }, { header: 'false' }, { inferTypes: null }, { indent: 100000 }]) {
      expect(isCsvToJsonOptions({ ...DEFAULT_CSV_TO_JSON, ...patch })).toBe(false);
    }
    for (const patch of [{ newline: 'x' }, { escapeFormulas: 'false' }, { flatten: {} }, { quoteAll: 1 }]) {
      expect(isJsonToCsvOptions({ ...DEFAULT_JSON_TO_CSV, ...patch })).toBe(false);
    }
  });
});
