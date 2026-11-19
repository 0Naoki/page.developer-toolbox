import { describe, expect, it } from 'vitest';
import { applyTextEdit, replaceTextSelectionWithCaret, TextEditHistory } from './textEdit';

const replaceTextSelection = (text: string, start: number, end: number, inserted: string) =>
  replaceTextSelectionWithCaret(text, start, end, inserted).value;

describe('元の改行を保つtextarea編集', () => {
  it('大容量の混在改行でも選択範囲を置換し、挿入直後の表示位置を返す', () => {
    const original = 'first\r\nsecond\rthird\n' + 'z'.repeat(51_000);
    const start = original.replace(/\r\n?/g, '\n').indexOf('third');
    const result = replaceTextSelectionWithCaret(original, start, start + 5, 'X\r\n😀');
    expect(result.value).toBe(original.replace('third', 'X\r\n😀'));
    expect(result.caret).toBe(start + 4);
  });
  it('CRの直後のEnterは、既存CRと結合せず1改行を追加する', () => {
    const result = applyTextEdit('a\rb', 'a\n\nb', { start: 2, end: 2, inputType: 'insertLineBreak' });
    expect(result.replace(/\r\n?/g, '\n')).toBe('a\n\nb');
    expect(result.startsWith('a\r')).toBe(true);
  });
  it('連続する異なる改行を、実際の削除・挿入位置に従って更新する', () => {
    expect(applyTextEdit('a\r\n\rb', 'a\nb', { start: 1, end: 1, inputType: 'deleteContentForward' })).toBe('a\rb');
    expect(applyTextEdit('a\r\n\rb', 'a\nb', { start: 3, end: 3, inputType: 'deleteContentBackward' })).toBe('a\r\nb');
    expect(applyTextEdit('a\r\nb', 'a\n\nb', { start: 1, end: 1, inputType: 'insertLineBreak' })).toBe('a\n\r\nb');
    expect(applyTextEdit('a\r\n\rb', 'ab', { start: 1, end: 3, inputType: 'deleteByCut' })).toBe('ab');
  });
  it('CRLF・CRの後ろの選択位置を元の文字列へ戻し、貼り付けた改行を保つ', () => {
    expect(replaceTextSelection('a\r\nb\rc', 2, 3, 'X\r\nY')).toBe('a\r\nX\r\nY\rc');
    expect(replaceTextSelection('a\r\nb', 1, 2, '\r')).toBe('a\rb');
  });
  it('全選択への貼り付け・空文字・末尾への挿入に対応する', () => {
    expect(replaceTextSelection('a\r\nb', 0, 3, 'x\n')).toBe('x\n');
    expect(replaceTextSelection('', 0, 0, 'x\r\n')).toBe('x\r\n');
    expect(replaceTextSelection('😀\r\n', 3, 3, '\t')).toBe('😀\r\n\t');
  });
  it('貼り付けの両端で単独のCRとLFが結合しても改行を失わない', () => {
    expect(replaceTextSelectionWithCaret('a\rb', 2, 2, '\n')).toEqual({ value: 'a\r\r\nb', caret: 3 });
    expect(replaceTextSelectionWithCaret('a\nb', 1, 1, '\r')).toEqual({ value: 'a\r\n\nb', caret: 2 });
    expect(replaceTextSelectionWithCaret('a\rX\nb', 2, 3, '')).toEqual({ value: 'a\r\n\nb', caret: 2 });
  });
  it('回帰：CRの改行とLFの改行の間の文字を消しても、2つの改行が1つのCRLFに結合しない', () => {
    /** 「a⏎X⏎b」の X を消すと「a\r\nb」になり、表示上の3行が2行になっていた */
    const original = 'a\rX\nb';
    const edited = 'a\n\nb';
    for (const selection of [{ start: 2, end: 3, inputType: 'deleteContentBackward' }, { start: 3, end: 3, inputType: 'deleteContentBackward' }, undefined]) {
      const value = applyTextEdit(original, edited, selection);
      expect(value.replace(/\r\n?/g, '\n'), JSON.stringify(selection)).toBe(edited);
      expect(value).toBe('a\r\n\nb');
    }
  });

  it('回帰：CRの改行の直後に、改行で始まる文字列を貼り付けても、改行が1つ消えない', () => {
    const value = applyTextEdit('a\rb', 'a\n\nfoob', { start: 2, end: 2, inputType: 'insertFromPaste' });
    expect(value.replace(/\r\n?/g, '\n')).toBe('a\n\nfoob');
    /** 貼り付けの処理（replaceTextSelectionWithCaret）と同じ表記にそろう */
    expect(value).toBe(replaceTextSelection('a\rb', 2, 2, '\nfoo'));
  });

  it('通常の編集で変更していないCRLF・CRを保つ', () => {
    expect(applyTextEdit('a\r\nb\rc', 'a\nb\nc')).toBe('a\r\nb\rc');
    expect(applyTextEdit('a\r\nb\rc', 'a\nXb\nc')).toBe('a\r\nXb\rc');
    expect(applyTextEdit('a\r\nb\rc', 'ab\nc')).toBe('ab\rc');
    expect(applyTextEdit('a\r\nb', 'a\n\nb')).toBe('a\r\n\nb');
  });
  it('絵文字・IMEで変わる文字列も、UTF-16の選択位置として扱う', () => {
    expect(applyTextEdit('😀\r\nか', '😁\nが')).toBe('😁\nが');
    expect(applyTextEdit('😀\r\nか', '😀\nが')).toBe('😀\r\nが');
  });
});

describe('改行を保持する編集履歴', () => {
  it('Undo・Redoは元のCRLF・CRを復元し、別の編集でRedoを破棄する', () => {
    const history = new TextEditHistory('a\r\n\rb');
    history.record('a\rb');
    expect(history.undo()).toBe('a\r\n\rb');
    expect(history.redo()).toBe('a\rb');
    history.undo();
    history.record('X\r\n\rb');
    expect(history.redo()).toBeNull();
    expect(history.undo()).toBe('a\r\n\rb');
  });
  it('IMEの途中経過を1操作にまとめ、外からの変更で履歴を破棄する', () => {
    const history = new TextEditHistory('a\r\n');
    history.record('a\r\nか');
    history.record('a\r\n漢', true);
    expect(history.undo()).toBe('a\r\n');
    history.reset('');
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });
  it('履歴の文字数と件数を制限する', () => {
    const history = new TextEditHistory('1234', 8);
    history.record('5678'); history.record('abcd'); history.record('efgh');
    expect(history.undo()).toBe('abcd');
    expect(history.undo()).toBe('5678');
    expect(history.undo()).toBeNull();
    const steps = new TextEditHistory('');
    for (let i = 0; i < 110; i++) steps.record(String(i));
    for (let i = 0; i < 100; i++) expect(steps.undo()).not.toBeNull();
    expect(steps.undo()).toBeNull();
  });
  it('CRとLFに挟まれた選択範囲のEnterも、表示上1改行を追加する', () => {
    expect(applyTextEdit('a\rX\nb', 'a\n\n\nb', { start: 2, end: 3, inputType: 'insertLineBreak' })).toBe('a\r\r\n\nb');
  });
});
