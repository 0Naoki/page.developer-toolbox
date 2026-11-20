import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../../lib/bytes';
import { INVALID_BASE64_PADDING, VALID_BASE64_PADDING } from '../../lib/bytes.fixtures';
import {
  bytesToText,
  decode,
  decodeBase64,
  decodeInput,
  encode,
  encodeBase64,
  hexDump,
  looksBinary,
  sniffType,
  surrogateWarning,
  toDataUri,
} from './logic';
import { findLoneSurrogate } from '../../lib/text/surrogate';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('Base64', () => {
  it.each(VALID_BASE64_PADDING)('有効なパディングと完全省略を読む：%s', (input, expected) => {
    expect(decodeBase64(input)).toBe(expected);
    expect(text(decodeInput(`data:text/plain;base64,${input}`).bytes)).toBe(expected);
  });

  it.each(INVALID_BASE64_PADDING)('不正なパディングを通常入力とdata: URIのどちらでも拒否する：%s', (input) => {
    expect(() => decodeBase64(input)).toThrow();
    expect(() => decodeInput(`data:text/plain;base64,${input}`)).toThrow();
  });

  it('日本語をエンコード・デコードできる', () => {
    const encoded = encodeBase64('こんにちは');
    expect(encoded).toBe('44GT44KT44Gr44Gh44Gv');
    expect(decodeBase64(encoded)).toBe('こんにちは');
  });

  it('URLセーフ形式は記号を置換しパディングを除く', () => {
    expect(encodeBase64('??>', true)).toBe('Pz8-');
    expect(encodeBase64('a', true)).toBe('YQ');
  });

  it('パディングなしのBase64URLもデコードできる', () => {
    expect(decodeBase64('Pz8-')).toBe('??>');
    expect(decodeBase64('YQ')).toBe('a');
  });

  it('不正な文字はエラーにする', () => {
    expect(() => decodeBase64('abc$')).toThrow('Base64に使えない文字が含まれています（$）');
  });

  it('空文字は空のまま', () => {
    expect(encodeBase64('')).toBe('');
    expect(base64ToBytes('')).toHaveLength(0);
  });

  it('途中のパディングと、長さの余りが1になる入力はエラーにする', () => {
    expect(() => base64ToBytes('YQ=a')).toThrow('パディング（=）は末尾にだけ書けます');
    expect(() => base64ToBytes('YQ==YQ==')).toThrow('パディング');
    expect(() => base64ToBytes('YWJjZ')).toThrow('長さが不正');
  });

  it('改行や空白を含む入力（MIME 形式）もデコードできる', () => {
    expect(text(base64ToBytes('44GT44KT\r\n44Gr44Gh 44Gv'))).toBe('こんにちは');
  });

  it('UTF-8 のテキストでないバイト列は、バイト列としてならデコードできる', () => {
    expect(Array.from(base64ToBytes('/w=='))).toEqual([0xff]);
    expect(() => decodeBase64('/w==')).toThrow('UTF-8のテキストではありません');
  });
});

describe('bytesToBase64', () => {
  it('MIME 形式では76文字ごとに改行し、末尾には改行を付けない', () => {
    /** 57バイトはちょうど76文字 */
    expect(bytesToBase64(new Uint8Array(57), { wrap: true })).not.toContain('\n');
    const lines = bytesToBase64(new Uint8Array(60), { wrap: true }).split('\n');
    expect(lines.map((l) => l.length)).toEqual([76, 4]);
    /** Base64URL（URL や JWT に使う）は改行しない */
    expect(bytesToBase64(new Uint8Array(60), { wrap: true, urlSafe: true })).not.toContain('\n');
  });

  it('大きなバイト列（20万バイト）でも引数の数の上限（RangeError）にかからない', () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => i & 255);
    const encoded = bytesToBase64(bytes);
    expect(encoded).toHaveLength(266_668);
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });
});

describe('decodeInput', () => {
  it('入力の形式を表示用に返す', () => {
    expect(decodeInput('Pz8-').variant).toBe('Base64URL');
    expect(decodeInput('Pz8/').variant).toBe('Base64');
    expect(decodeInput('YQ').variant).toBe('記号なし（Base64・Base64URL のどちらとしても同じ）・パディングなし');
    expect(decodeInput('YQ==').variant).toBe('記号なし（Base64・Base64URL のどちらとしても同じ）・パディングあり');
    expect(decodeInput('+/8-').variant).toBe('Base64 と Base64URL の記号が混在');
    expect(decodeInput('44GT44KT\n44Gr').variant).toContain('改行あり');
  });

  it('data: URI（Base64）を読む', () => {
    const d = decodeInput('  data:text/plain;charset=utf-8;base64,44GC  ');
    expect(text(d.bytes)).toBe('あ');
    expect(d.mime).toBe('text/plain');
    expect(d.variant).toBe('data: URI（Base64）');
  });

  it('data: URI のパーセント復号は、1文字ずつ UTF-8 にする実装と同じバイト列になる', () => {
    /** 以前の実装（1文字ずつ TextEncoder に渡す）。結果を変えずに速くしたことを確かめる正解として使う */
    const reference = (s: string) => {
      const out: number[] = [];
      const encoder = new TextEncoder();
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
          out.push(parseInt(s.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          const ch = String.fromCodePoint(s.codePointAt(i)!);
          for (const b of encoder.encode(ch)) out.push(b);
          i += ch.length - 1;
        }
      }
      return out;
    };
    const bodies = [
      '', 'Hello', 'あいう', '𠮷😀', '\ud83d', 'a\ude00b', '\ud83d%41\ude00', '%E3%81%82', '%e3%81%82x',
      '%G1', '%', 'a%', '%4', '%%41', '100%', '%41%42%43', 'あ%20い%2', '😀%F0%9F%98%80\ud800%zz', '%%%', 'x%2541',
    ];
    for (const body of bodies) expect(Array.from(decodeInput(`data:,${body}`).bytes), JSON.stringify(body)).toEqual(reference(body));
  });

  it('入力上限に近い大きな data: URI も、まとめて変換して全体を復号する', () => {
    /** まとめて変換する区間の境目（「%XX」の前後）が多い約800万文字。処理時間はテストでは確かめない（並行実行で変わるため） */
    const { bytes } = decodeInput(`data:,${'aあ%41'.repeat(1_600_000)}`);
    expect(bytes.length).toBe(8_000_000);
    expect(Array.from(bytes.subarray(0, 10))).toEqual([0x61, 0xe3, 0x81, 0x82, 0x41, 0x61, 0xe3, 0x81, 0x82, 0x41]);
    expect(Array.from(bytes.subarray(-5))).toEqual([0x61, 0xe3, 0x81, 0x82, 0x41]);
    const base64 = decodeInput(`data:;base64,${'QUJD'.repeat(1_000_000)}`);
    expect(base64.bytes.length).toBe(3_000_000);
    expect(new TextDecoder().decode(base64.bytes.subarray(-3))).toBe('ABC');
  }, 30_000);

  it('data: URI（パーセントエンコード）を読む。MIME タイプを省略すると text/plain', () => {
    const d = decodeInput('data:,Hello%2C%20%E3%81%82𠮷');
    expect(text(d.bytes)).toBe('Hello, あ𠮷');
    expect(d.mime).toBe('text/plain');
    expect(decodeInput('DATA:;BASE64,YQ').mime).toBe('text/plain');
  });

  it('data: URI をブラウザ（Fetch Standard）と同じ内容に復号する', async () => {
    const cases = [
      ['data:text/plain;base64,SGVsbG8%3D', 'Hello'],
      ['data:text/plain,Hello#section', 'Hello'],
      ['data:text/plain;base64,SGVs#bG8=', 'Hel'],
      ['data:;base64;charset=x,SGVsbG8=', 'SGVsbG8='],
      ['data:text/plain; BASE64 ,SGk=', 'Hi'],
      ['data:,a%2', 'a%2'],
      ['data:text/plain,Hello\nWorld', 'HelloWorld'],
      ['data:text/plain,Hello%0AWorld', 'Hello\nWorld'],
      ['data:text/plain,Hel\tlo\r\nWorld', 'HelloWorld'],
      ['data:text/pl\nain;base\n64,SGVs\nbG8=', 'Hello'],
    ];
    for (const [uri, expected] of cases as [string, string][]) {
      expect(text(decodeInput(uri).bytes), uri).toBe(expected);
      /** Node の fetch（Fetch Standard の実装）の結果とも一致する */
      expect(await (await fetch(uri)).text(), uri).toBe(expected);
    }
    expect(decodeInput('data:;base64;charset=x,SGVsbG8=').variant).toBe('data: URI（パーセントエンコード）');
    expect(() => decodeInput('data:;base64,%E3%81%82')).toThrow();
    expect(decodeInput('data:text/pl\nain;base64,SGk=')).toMatchObject({ mime: 'text/plain', variant: 'data: URI（Base64）' });
  });

  it('data: URI でない入力の mime は null', () => {
    expect(decodeInput('YQ==').mime).toBeNull();
  });
});

describe('bytesToText', () => {
  it('Shift_JIS・EUC-JP・UTF-16LE で読める', () => {
    expect(bytesToText(Uint8Array.from([0x82, 0xa0]), 'shift_jis')).toBe('あ');
    expect(bytesToText(Uint8Array.from([0xa4, 0xa2]), 'euc-jp')).toBe('あ');
    expect(bytesToText(Uint8Array.from([0x42, 0x30]), 'utf-16le')).toBe('あ');
  });

  it('その文字コードとして不正なら null', () => {
    expect(bytesToText(Uint8Array.from([0xff]), 'utf-8')).toBeNull();
    expect(bytesToText(Uint8Array.from([0x42, 0x30, 0x41]), 'utf-16le')).toBeNull();
  });

  it('制御文字を含むテキストはバイナリの可能性が高いとみなす', () => {
    expect(looksBinary('a\0b')).toBe(true);
    expect(looksBinary('a\tb\r\nc')).toBe(false);
  });
});

describe('sniffType', () => {
  it('先頭のバイトからファイルの種類を推定する', () => {
    expect(sniffType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.ext).toBe('png');
    expect(sniffType(new TextEncoder().encode('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(sniffType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8'))?.ext).toBe('webp');
    expect(sniffType(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe('hexDump', () => {
  it('hexdump -C と同じ形式で表示する', () => {
    expect(hexDump(new TextEncoder().encode('Hello World\n'))).toBe(
      '00000000  48 65 6c 6c 6f 20 57 6f  72 6c 64 0a' + ' '.repeat(14) + '|Hello World.|',
    );
    const full = hexDump(Uint8Array.from({ length: 17 }, (_, i) => i + 0x7e)).split('\n');
    expect(full[0]).toBe('00000000  7e 7f 80 81 82 83 84 85  86 87 88 89 8a 8b 8c 8d  |~...............|');
    expect(full[1]).toMatch(/^00000010 {2}8e /);
  });

  it('上限を超える部分は表示しない', () => {
    expect(hexDump(new Uint8Array(40), 32).split('\n')).toHaveLength(2);
    expect(hexDump(new Uint8Array())).toBe('');
  });
});

describe('対になっていないサロゲート', () => {
  it('位置を返す。正しいサロゲートペア（𠮷）は対象外', () => {
    expect(findLoneSurrogate('a\uD800b')).toBe(1);
    expect(findLoneSurrogate('\uDC00')).toBe(0);
    expect(findLoneSurrogate('a\uD800')).toBe(1);
    expect(findLoneSurrogate('𠮷野家')).toBe(-1);
  });

  it('URL エンコードでは英語の例外でなく、位置を示したエラーにする', () => {
    expect(() => encode('a\uD800b', 'url')).toThrow('2 文字目（U+D800）が対になっていないサロゲートのため、URLエンコードできません');
  });

  it('Base64 では U+FFFD に置き換わることを警告する', () => {
    expect(encode('a\uD800b', 'base64')).toBe('Ye+/vWI=');
    expect(surrogateWarning('a\uD800b')).toContain('2 文字目（U+D800）');
    expect(surrogateWarning('𠮷')).toBeNull();
  });
});

describe('toDataUri', () => {
  it('MIME タイプを付けて data: URI にする', () => {
    expect(toDataUri(Uint8Array.from([0x61]), 'text/plain')).toBe('data:text/plain;base64,YQ==');
    expect(toDataUri(Uint8Array.from([0x61]), '')).toBe('data:application/octet-stream;base64,YQ==');
  });
});

describe('URLエンコード', () => {
  it('相互変換できる', () => {
    expect(encode('a b&c=日本', 'url')).toBe('a%20b%26c%3D%E6%97%A5%E6%9C%AC');
    expect(decode('a+b%26c', 'url')).toBe('a b&c');
  });

  it('不正な形式はエラーにする', () => {
    expect(() => decode('%E3%81', 'url')).toThrow();
  });
});

describe('先頭の U+FEFF', () => {
  it('UTF-8 の往復で消えない', () => {
    expect(encodeBase64('﻿abc')).toBe('77u/YWJj');
    expect(decodeBase64('77u/YWJj')).toBe('﻿abc');
    expect(decodeBase64(encodeBase64('﻿﻿a'))).toBe('﻿﻿a');
  });

  it('UTF-16LE の BOM も取り除かない', () => {
    expect(bytesToText(Uint8Array.from([0xff, 0xfe, 0x61, 0x00]), 'utf-16le')).toBe('﻿a');
  });
});

describe('エラーの表示', () => {
  it('使えない文字が絵文字でも、半分に切らずに1文字として示す', () => {
    expect(() => base64ToBytes('YQ😀')).toThrow('Base64に使えない文字が含まれています（😀）');
  });
});
