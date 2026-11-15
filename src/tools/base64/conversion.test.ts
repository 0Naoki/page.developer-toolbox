import { describe, expect, it } from 'vitest';
import { convertFile, effectiveOptions, type ConversionSettings } from './conversion';

const settings: ConversionSettings = { direction: 'encode', mode: 'base64', source: 'file', wrap: true, asDataUri: true };

describe('入力元と形式に応じた変換', () => {
  it('data: URI は折り返さず、Base64URL は data: URI と折り返しの保存設定を無視する', () => {
    expect(effectiveOptions(settings)).toEqual({ fromFile: true, dataUri: true, wrapped: false });
    expect(effectiveOptions({ ...settings, mode: 'base64url' })).toEqual({ fromFile: true, dataUri: false, wrapped: false });
    expect(effectiveOptions({ ...settings, asDataUri: false })).toEqual({ fromFile: true, dataUri: false, wrapped: true });
  });

  it('デコードと URL エンコードは、ファイル入力の保存設定があってもテキストを使う', () => {
    expect(effectiveOptions({ ...settings, direction: 'decode' })).toEqual({ fromFile: false, dataUri: false, wrapped: true });
    expect(effectiveOptions({ ...settings, mode: 'url' })).toEqual({ fromFile: false, dataUri: false, wrapped: false });
    expect(effectiveOptions({ ...settings, source: 'text' })).toEqual({ fromFile: false, dataUri: false, wrapped: true });
  });

  it('同じバイト列を標準形式・URL形式で書き分け、未選択なら結果を出さない', () => {
    const file = { name: 'binary.bin', type: '', bytes: new Uint8Array([0xfb, 0xff]) };
    expect(convertFile(null, 'base64', false, false)).toEqual({ kind: 'empty' });
    expect(convertFile(file, 'base64', false, false)).toEqual({ kind: 'text', output: '+/8=', warning: null });
    expect(convertFile(file, 'base64url', false, false)).toEqual({ kind: 'text', output: '-_8', warning: null });
    expect(convertFile(file, 'base64', true, false)).toEqual({ kind: 'text', output: 'data:application/octet-stream;base64,+/8=', warning: null });
  });

  it('ファイルの MIME タイプを優先し、なければ実バイトから画像を判定する', () => {
    const file = { name: 'image', type: '', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
    expect(convertFile(file, 'base64', true, false)).toMatchObject({ output: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(convertFile({ ...file, type: 'application/octet-stream' }, 'base64', true, false)).toMatchObject({ output: 'data:application/octet-stream;base64,iVBORw0KGgo=' });
  });
});
