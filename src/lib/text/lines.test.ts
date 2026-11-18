/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R017] 行の分割：`src/lib/text/lines.fixtures.ts` の改行の形式（LF・CRLF・CR・混在・空の行・末尾の改行）を、独自休日・サブネットの一覧（IPv4・IPv6）・テキスト差分・PEM のヘッダー行で同じように扱い、
 *   行番号を元の行に合わせること。行の文字列を作らない走査（eachLineRange・endsLineAt。文字数・テキスト差分・JSON の行番号が使う）も同じ行にすること（あわせて `logic.test.ts`）
 */
import { describe, expect, it } from 'vitest';
import { eachLineRange, endsLineAt, splitLines } from './lines';
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

/** 行の文字列を作らない走査（eachLineRange・endsLineAt）も、splitLines と同じ行にする（文字数・差分・JSON の行番号が共通で使う） */
describe('行の範囲と行の終わり', () => {
  const rangesOf = (text: string) => {
    const ranges: { start: number; end: number; breakLength: number }[] = [];
    eachLineRange(text, (start, end, breakLength) => {
      ranges.push({ start, end, breakLength });
    });
    return ranges;
  };

  it.each(LINE_BREAK_CASES)('$name', ({ text, lines }) => {
    const ranges = rangesOf(text);
    expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual(lines);
    /** 改行の長さを足すと、次の行の始まりになる */
    ranges.slice(0, -1).forEach((r, i) => expect(r.end + r.breakLength).toBe(ranges[i + 1]?.start));
    expect(ranges.at(-1)).toMatchObject({ end: text.length, breakLength: 0 });
    /** 行の終わりと数えた位置の数は、改行の数と同じ */
    expect([...text].filter((_, i) => endsLineAt(text, i)).length).toBe(lines.length - 1);
  });

  it('CRLF は2文字の改行で、LF の位置で行が終わる', () => {
    expect(rangesOf('a\r\nb')).toEqual([{ start: 0, end: 1, breakLength: 2 }, { start: 3, end: 4, breakLength: 0 }]);
    expect([endsLineAt('a\r\nb', 1), endsLineAt('a\r\nb', 2)]).toEqual([false, true]);
  });

  it('空文字は1つの空の行で、false を返すとそこで止める', () => {
    expect(rangesOf('')).toEqual([{ start: 0, end: 0, breakLength: 0 }]);
    const visited: number[] = [];
    eachLineRange('a\nb\nc', (start) => {
      visited.push(start);
      return visited.length < 2 ? undefined : false;
    });
    expect(visited).toEqual([0, 2]);
  });
});
