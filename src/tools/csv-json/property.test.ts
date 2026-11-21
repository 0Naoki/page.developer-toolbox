/**
 * CSV ⇔ JSON のプロパティテスト（fast-check で入力を生成し、どの入力でも成り立つ性質を確かめる）。
 * 個別の入力の期待値は parseCsv.test.ts・writeCsv.test.ts・roundTrip.test.ts にある。失敗したときは、表示された seed と path を fc.assert の引数に足すと同じ入力で再現できる。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Delimiter } from './csvFormat';
import { DEFAULT_CSV_TO_JSON, csvToJson, uniqueHeaders } from './logic';
import { parseCsv } from './parseCsv';
import { DEFAULT_JSON_TO_CSV, jsonToCsv } from './writeCsv';

const delimiterArb = fc.constantFrom<Delimiter>(',', '\t', ';', '|');
const newlineArb = fc.constantFrom<'\n' | '\r\n'>('\n', '\r\n');
/**
 * セルの値。区切り文字・引用符・改行・前後の空白・BOM・数式に見える文字を多めに混ぜる。
 * 対になっていないサロゲートは CSV にできない（writeCsv.ts で拒否する）ため、書記素の単位で作る
 */
const cellArb = fc.oneof(
  fc.string({ unit: fc.constantFrom(',', '\t', ';', '|', '"', '\r', '\n', ' ', '﻿', '=', '-', 'a', '0', 'あ', '👍'), maxLength: 6 }),
  fc.string({ unit: 'grapheme', maxLength: 6 }),
);
const rowsArb = fc.array(fc.array(cellArb, { minLength: 1, maxLength: 5 }), { maxLength: 6 });

describe('jsonToCsv → parseCsv', () => {
  it('文字列の配列の配列を CSV に書いて読み直すと、どの区切り文字・改行・引用の設定でも同じ値に戻る', () => {
    fc.assert(
      fc.property(rowsArb, delimiterArb, newlineArb, fc.boolean(), (rows, delimiter, newline, quoteAll) => {
        const { csv } = jsonToCsv(JSON.stringify(rows), { ...DEFAULT_JSON_TO_CSV, delimiter, newline, quoteAll, escapeFormulas: false, header: false });
        expect(parseCsv(csv, delimiter)).toEqual(rows);
      }),
    );
  });

  it('数式の無効化を有効にすると、どのセルも数式の記号（= + - @ など）で始まらないか、数値として読める', () => {
    fc.assert(
      fc.property(rowsArb, delimiterArb, (rows, delimiter) => {
        const { csv } = jsonToCsv(JSON.stringify(rows), { ...DEFAULT_JSON_TO_CSV, delimiter, header: false });
        for (const cell of parseCsv(csv, delimiter).flat()) {
          if (/^[=+\-@\t\r\n＝＋－＠]/.test(cell)) expect(cell).toMatch(/^[+-]?(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?$/);
        }
      }),
    );
  });
});

describe('csvToJson → jsonToCsv', () => {
  it('型を変換しない設定では、項目名付きの CSV を JSON にして CSV に戻すと、値は元に戻り、項目名は空・重複だけが一意な名前になる', () => {
    const tableArb = fc.integer({ min: 1, max: 4 }).chain((columns) =>
      fc.tuple(
        fc.array(fc.oneof(cellArb, fc.constantFrom('', 'a', 'a_2', 'column1')), { minLength: columns, maxLength: columns }),
        fc.array(fc.array(cellArb, { minLength: columns, maxLength: columns }), { maxLength: 5 }),
      ),
    );
    fc.assert(
      fc.property(tableArb, delimiterArb, ([header, body], delimiter) => {
        const source = jsonToCsv(JSON.stringify([header, ...body]), { ...DEFAULT_JSON_TO_CSV, delimiter, escapeFormulas: false, header: false }).csv;
        const json = csvToJson(source, { ...DEFAULT_CSV_TO_JSON, delimiter, inferTypes: false, skipEmptyLines: false }).json;
        const back = jsonToCsv(json, { ...DEFAULT_JSON_TO_CSV, delimiter, escapeFormulas: false }).csv;
        expect(parseCsv(back, delimiter)).toEqual(body.length === 0 ? [] : [uniqueHeaders(header), ...body]);
      }),
    );
  });
});

describe('parseCsv', () => {
  it('どんな文字列でも、例外を投げるなら文言付きの Error で、読めたら行は1列以上ある', () => {
    const textArb = fc.string({ unit: fc.constantFrom(',', '"', '\r', '\n', ' ', 'a', '﻿'), maxLength: 40 });
    fc.assert(
      fc.property(textArb, delimiterArb, fc.boolean(), fc.boolean(), (text, delimiter, skipInitialSpace, skipEmptyLines) => {
        let rows: string[][];
        try {
          rows = parseCsv(text, delimiter, { skipInitialSpace, skipEmptyLines });
        } catch (e) {
          expect((e as Error).constructor).toBe(Error);
          expect((e as Error).message).toMatch(/行/);
          return;
        }
        expect(rows.every((row) => row.length > 0)).toBe(true);
      }),
    );
  });
});
