import { describe, expect, it } from 'vitest';
import { bytesToBase64, toHex } from '../../lib/bytes';
import { Md5, digest, hmac, hmacKeyBytes, md5Chunked, sameHash, surrogateWarning, utf8 } from './logic';

/** 一度に渡した MD5（分けて渡す md5Chunked・Md5.update の結果と比べる基準） */
const md5 = (data: Uint8Array) => new Md5().update(data).digest();

const FOX = 'The quick brown fox jumps over the lazy dog';

describe('md5', () => {
  it('RFC 1321 のテストベクタと一致する', () => {
    expect(toHex(md5(utf8('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(toHex(md5(utf8('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(toHex(md5(utf8('12345678901234567890123456789012345678901234567890123456789012345678901234567890')))).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    );
    expect(toHex(md5(utf8(FOX)))).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('ブロック境界（55/56/64バイト）でも正しい', () => {
    expect(toHex(md5(utf8('a'.repeat(55))))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(toHex(md5(utf8('a'.repeat(56))))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(toHex(md5(utf8('a'.repeat(64))))).toBe('014842d480b571495a4a0363793f7367');
  });
});

describe('digest', () => {
  it('SHA-256', async () => {
    expect(toHex(await digest('SHA-256', utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('日本語はUTF-8として扱う', async () => {
    expect(toHex(await digest('SHA-1', utf8('あ')))).toBe('98fdfc0a7426bbb0fca0b106fd1a6c907446d7c0');
  });

  it('HMAC-SHA256', async () => {
    expect(toHex(await hmac('SHA-256', utf8('key'), utf8(FOX)))).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });
});

describe('sameHash', () => {
  it('大文字・区切り文字を無視して照合する', () => {
    const hex = toHex(md5(utf8('abc')));
    const b64 = bytesToBase64(md5(utf8('abc')));
    expect(sameHash('90:01:50:98:3C:D2:4F:B0:D6:96:3F:7D:28:E1:7F:72', hex, b64)).toBe(true);
    expect(sameHash(b64, hex, b64)).toBe(true);
    expect(sameHash('0000', hex, b64)).toBe(false);
  });
});

describe('大きなデータの MD5', () => {
  it('分割して渡しても一度に渡したときと同じ', () => {
    const data = utf8('x'.repeat(1000) + 'あいう'.repeat(200));
    const whole = toHex(md5(data));
    for (let t = 0; t < 50; t++) {
      const h = new Md5();
      let off = 0;
      while (off < data.length) {
        const size = Math.floor(Math.random() * 130);
        h.update(data.subarray(off, off + size));
        off += size;
      }
      expect(toHex(h.digest())).toBe(whole);
    }
  });

  it('4MB 単位の逐次計算でも結果が同じで、進捗を報告する', async () => {
    const data = new Uint8Array(9 * 1024 * 1024 + 123).map((_, i) => i % 251);
    const progress: number[] = [];
    const chunked = await md5Chunked(data, (r) => progress.push(r));
    expect(toHex(chunked!)).toBe(toHex(md5(data)));
    /** 9MB 強 → 4MB ずつ3回に分けて処理し、進捗は増え続けて最後に 1 になる */
    expect(progress.length).toBe(3);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(new Set(progress).size).toBe(progress.length);
    expect(progress[2]).toBe(1);
  });

  it('途中で中止できる', async () => {
    const data = new Uint8Array(9 * 1024 * 1024);
    expect(await md5Chunked(data, undefined, () => true)).toBe(null);
  });
});

describe('HMAC の空の鍵', () => {
  it('日本語のメッセージでエラーにする', async () => {
    let message = '';
    try {
      await hmac('SHA-256', utf8(''), utf8('x'));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe('HMAC の秘密鍵を入力してください');
  });
});

describe('対になっていないサロゲート', () => {
  it('テキストは U+FFFD に置き換えて計算したことを警告する', () => {
    expect(surrogateWarning('a\uD800b')).toContain('2 文字目（U+D800）');
    expect(surrogateWarning('𠮷野家')).toBeNull();
  });

  it('HMAC の秘密鍵は、別の鍵（U+FFFD）で計算せずにエラーにする', () => {
    expect(() => hmacKeyBytes('k\uDC00')).toThrow('秘密鍵の2 文字目（U+DC00）が対になっていないサロゲート');
    expect(toHex(hmacKeyBytes('𠮷'))).toBe(toHex(utf8('𠮷')));
  });
});
