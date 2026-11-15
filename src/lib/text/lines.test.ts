/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - 行の分割：`src/lib/text/lines.fixtures.ts` の改行の形式（LF・CRLF・CR・混在・空の行・末尾の改行）を、独自休日・サブネットの一覧（IPv4・IPv6）・テキスト差分・PEM のヘッダー行で同じように扱い、
 *   行番号を元の行に合わせること（あわせて `logic.test.ts`）
 */
import { describe, expect, it } from 'vitest';
import { splitLines } from './lines';
import { LINE_BREAK_CASES } from './lines.fixtures';

describe('行の分割', () => {
  it.each(LINE_BREAK_CASES)('$name', ({ text, lines }) => {
    expect(splitLines(text)).toEqual(lines);
  });

  it('CRLF を2行に分けず、LF の後の CR は別の改行にする', () => {
    expect(splitLines('a\r\nb')).toHaveLength(2);
    expect(splitLines('a\n\rb')).toEqual(['a', '', 'b']);
  });

  it('空文字は1つの空の行で、上限を指定すると先頭の行だけを返す', () => {
    expect(splitLines('')).toEqual(['']);
    expect(splitLines('a\rb\r\nc\nd', 2)).toEqual(['a', 'b']);
  });
});
