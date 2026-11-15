import { describe, expect, it } from 'vitest';
import { decodeText, FILE_READ_ERROR, FileInputError, fileTooLargeMessage, formatByteLimit, formatBytes, readFileWithin } from './file';

describe('ファイルの文字コード', () => {
  const sjis = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 10, 0x82, 0xa0]);

  it('選んだ文字コードとして不正なバイトを置換文字へ変えない', () => {
    expect(() => decodeText(sjis, 'utf-8')).toThrow();
    expect(() => decodeText(new Uint8Array([0x82]), 'shift_jis')).toThrow();
  });

  it('正しい文字コードなら日本語と引用符内の改行を保持する', () => {
    expect(decodeText(sjis, 'shift_jis')).toBe('name\nあ');
    const text = 'name,notes\r\nあ,"x\r\ny"';
    expect(decodeText(new TextEncoder().encode(text), 'utf-8')).toBe(text);
  });
});

describe('ファイルの上限と読み込み', () => {
  it('上限は丸めずに書き、MiB・KiB で割り切れない値はバイト数で書く', () => {
    expect([5 * 1024 ** 2, 256 * 1024 ** 2, 16 * 1024, 24_000_000, 1000].map(formatByteLimit))
      .toEqual(['5 MiB', '256 MiB', '16 KiB', '24,000,000 バイト', '1,000 バイト']);
    expect(fileTooLargeMessage(1024 ** 2)).toBe('ファイルが大きすぎます（上限 1 MiB）');
  });

  it('上限ちょうどは読み、1バイトでも超えると共通の文言で断る', async () => {
    await expect(readFileWithin(new File([new Uint8Array(4)], 'a.bin'), 4)).resolves.toEqual(new Uint8Array(4));
    const over = readFileWithin(new File([new Uint8Array(5)], 'a.bin'), 4);
    await expect(over).rejects.toBeInstanceOf(FileInputError);
    await expect(over).rejects.toThrow(fileTooLargeMessage(4));
  });

  it('中身を読めないファイルは、ブラウザの例外ではなく共通の文言にする', async () => {
    const broken = new File([], 'gone.bin');
    Object.defineProperty(broken, 'arrayBuffer', { value: () => Promise.reject(new DOMException('NotReadableError', 'NotReadableError')) });
    const read = readFileWithin(broken, 10);
    await expect(read).rejects.toBeInstanceOf(FileInputError);
    await expect(read).rejects.toThrow(FILE_READ_ERROR);
  });
});

describe('サイズの表示', () => {
  it('1024 を基準にした値を KiB・MiB・GiB と書く', () => {
    expect([1023, 1024, 5 * 1024 ** 2, 256 * 1024 ** 2, 3 * 1024 ** 3].map(formatBytes)).toEqual(['1023 B', '1.0 KiB', '5.0 MiB', '256.0 MiB', '3.00 GiB']);
  });
});
