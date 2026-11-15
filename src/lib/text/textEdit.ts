/** textarea の選択位置（CRLF を1単位とする）を、元の文字列の UTF-16 位置に戻す。 */
function sourceOffset(text: string, position: number): number {
  let offset = 0;
  for (let index = 0; index < position && offset < text.length; index++) {
    offset += text[offset] === '\r' && text[offset + 1] === '\n' ? 2 : 1;
  }
  return offset;
}

/** 改行を保持して置換し、textarea 上で挿入直後になる位置も返す。 */
export function replaceTextSelectionWithCaret(text: string, start: number, end: number, inserted: string): { value: string; caret: number } {
  const before = text.slice(0, sourceOffset(text, start));
  const after = text.slice(sourceOffset(text, end));
  /** 別々の改行が境界でCRLFに結合しないよう、必要な箇所だけCRLFにそろえる。 */
  const pasted = before.endsWith('\r') && inserted.startsWith('\n') ? '\r' + inserted : inserted;
  let prefix = before + pasted;
  if (prefix.endsWith('\r') && after.startsWith('\n')) prefix += '\n';
  return { value: prefix + after, caret: prefix.replace(/\r\n?/g, '\n').length };
}

export type TextEditSelection = { start: number; end: number; inputType: string };

function replaceNativeSelection(text: string, start: number, end: number, inserted: string): string {
  const prefix = text.slice(0, sourceOffset(text, start));
  const suffix = text.slice(sourceOffset(text, end));
  /** 既存の CR と新しい LF が結合して、Enter の1行分が失われるのを防ぐ。 */
  if (inserted === '\n' && prefix.endsWith('\r')) inserted = suffix.startsWith('\n') ? '\r\n' : '\r';
  return prefix + inserted + suffix;
}

/** beforeinput の選択位置を優先し、同じ見た目の改行が続く場合も実際の編集範囲を使う。 */
export function applyTextEdit(original: string, edited: string, selection?: TextEditSelection): string {
  const displayed = original.replace(/\r\n?/g, '\n');
  if (displayed === edited) return original;
  if (selection) {
    let { start, end } = selection;
    const removed = displayed.length - edited.length;
    if (start === end && removed > 0 && selection.inputType.startsWith('delete')) {
      if (selection.inputType.endsWith('Backward')) start = Math.max(0, start - removed);
      else if (selection.inputType.endsWith('Forward')) end += removed;
    }
    const insertedLength = edited.length - (displayed.length - (end - start));
    if (start >= 0 && end <= displayed.length && insertedLength >= 0 &&
      displayed.slice(0, start) === edited.slice(0, start) && displayed.slice(end) === edited.slice(start + insertedLength)) {
      return replaceNativeSelection(original, start, end, edited.slice(start, start + insertedLength));
    }
  }
  /** 選択位置が取得できない入力操作では、変更した範囲を文字列から求める。 */
  let start = 0;
  while (start < displayed.length && start < edited.length && displayed[start] === edited[start]) start++;
  let end = displayed.length;
  let editedEnd = edited.length;
  while (end > start && editedEnd > start && displayed[end - 1] === edited[editedEnd - 1]) { end--; editedEnd--; }
  return replaceNativeSelection(original, start, end, edited.slice(start, editedEnd));
}

/** 編集履歴に残す操作の数 */
const MAX_ENTRIES = 100;

/** 改行の元表記を保持する、メモリ内だけの編集履歴。 */
export class TextEditHistory {
  private past: string[] = [];
  private future: string[] = [];
  current: string;
  private readonly budget: number;
  constructor(value: string, budget = 8_000_000) { this.current = value; this.budget = budget; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  reset(value: string) { this.current = value; this.past = []; this.future = []; }
  record(value: string, merge = false) {
    if (value === this.current) return;
    if (!merge) this.past.push(this.current);
    this.current = value;
    this.future = [];
    this.trim();
  }
  undo(): string | null {
    if (!this.canUndo) return null;
    this.future.push(this.current);
    this.current = this.past.pop()!;
    this.trim();
    return this.current;
  }
  redo(): string | null {
    if (!this.canRedo) return null;
    this.past.push(this.current);
    this.current = this.future.pop()!;
    this.trim();
    return this.current;
  }
  private trim() {
    let size = [...this.past, ...this.future].reduce((sum, text) => sum + text.length, 0);
    while (this.past.length + this.future.length > MAX_ENTRIES || size > this.budget) {
      const removed = this.past.length ? this.past.shift() : this.future.shift();
      if (removed === undefined) break;
      size -= removed.length;
    }
  }
}
