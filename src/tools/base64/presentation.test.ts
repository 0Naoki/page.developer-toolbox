import { describe, expect, it } from 'vitest';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { HEX_DUMP_MAX, type TextConversion } from './logic';
import { decodedResultText, presentResult, savedFileOf } from './presentation';

const bytes = (value: number[]): TextConversion => ({ kind: 'bytes', bytes: Uint8Array.from(value), mime: null, variant: 'Base64' });

describe('復号結果の表示と入れ替え', () => {
  it('文字コードによる読み分けと、先頭の BOM を保つ', () => {
    const japanese = bytes([0x82, 0xa0]);
    expect(decodedResultText(japanese, 'utf-8')).toBeNull();
    expect(decodedResultText(japanese, 'shift_jis')).toBe('あ');
    expect(decodedResultText(bytes([0xef, 0xbb, 0xbf, 0x61]), 'utf-8')).toBe('\uFEFFa');
    expect(decodedResultText(bytes([0]), 'utf-8')).toBeNull();
  });

  it('テキストは全文を入れ替えられ、16進表示を選んだ場合はダンプを入れ替えない', () => {
    const result = bytes([0x61, 0x62]);
    expect(presentResult(result, 'ab', 'text', false)).toMatchObject({ showHex: false, outputText: 'ab', canSwap: true, dump: '' });
    expect(presentResult(result, 'ab', 'hex', false)).toMatchObject({ showHex: true, outputText: '', canSwap: false });
    expect(presentResult(result, null, 'text', false)).toMatchObject({ showHex: true, outputText: '', canSwap: false });
  });

  it('ダンプは先頭だけにしても、復号した元バイト列は変えない', () => {
    const result = bytes(Array(HEX_DUMP_MAX + 16).fill(0x61));
    const shown = presentResult(result, null, 'hex', false);
    expect(shown.dump).toContain('00003ff0');
    expect(shown.dump).not.toContain('00004000');
    expect(result.kind === 'bytes' && result.bytes.length).toBe(HEX_DUMP_MAX + 16);
  });

  it('逆方向の入力上限までは全文を使い、上限を超える出力・ファイル入力・失敗は入れ替えない', () => {
    const result: TextConversion = { kind: 'text', output: 'x'.repeat(MAX_CALCULATION_INPUT), warning: null };
    expect(presentResult(result, null, 'text', false)).toMatchObject({ swapTooLarge: false, canSwap: true });
    const over = presentResult({ ...result, output: result.output + 'x' }, null, 'text', false);
    expect(over).toMatchObject({ swapTooLarge: true, canSwap: false });
    expect(over.outputText.length).toBe(MAX_CALCULATION_INPUT + 1);
    expect(presentResult(result, null, 'text', true).canSwap).toBe(false);
    expect(presentResult({ kind: 'error', error: '失敗' }, null, 'text', false).canSwap).toBe(false);
    expect(presentResult({ kind: 'empty' }, null, 'text', false).canSwap).toBe(false);
  });
});

describe('復号結果の保存', () => {
  it('data: URI の MIME タイプを優先し、拡張子は判定した種類から付ける', () => {
    const png = { mime: 'image/png', ext: 'png' };
    expect(savedFileOf('image/x-custom', png)).toEqual({ filename: 'decoded.png', mime: 'image/x-custom' });
    expect(savedFileOf(null, png)).toEqual({ filename: 'decoded.png', mime: 'image/png' });
  });

  it('種類を判定できなければ、テキストは txt、それ以外は bin にする', () => {
    expect(savedFileOf('text/plain', null)).toEqual({ filename: 'decoded.txt', mime: 'text/plain' });
    expect(savedFileOf('application/json', null)).toEqual({ filename: 'decoded.bin', mime: 'application/json' });
    expect(savedFileOf(null, null)).toEqual({ filename: 'decoded.bin', mime: 'application/octet-stream' });
  });
});
