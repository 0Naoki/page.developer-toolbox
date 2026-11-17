import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CopyButton } from './CopyButton';
import { TEXT_PREVIEW_LIMIT, TEXT_PREVIEW_LIMIT_LABEL, textPreview } from '../lib/text/textPreview';
import { applyTextEdit, replaceTextSelectionWithCaret, TextEditHistory, type TextEditSelection } from '../lib/text/textEdit';
import { isImeComposing } from '../lib/keyboard';
import { useLatest } from '../hooks/useLatest';
import { formatNumber } from '../lib/number';

/**
 * 大きな入力は全文を状態に保持し、ネイティブ textarea の大量レイアウトを避ける。
 * 大きな貼り付けは部品が自分で入力を置き換えてブラウザの編集履歴に残らないため、元に戻す・やり直すは
 * 改行を保持するかどうかに関係なく、部品の履歴（TextEditHistory）で行う。
 */
export function LargeTextInput({ value, onChange, label, className = 'code', placeholder, preserveLineEndings = false, resetKey = 0, limit }: {
  value: string; onChange: (value: string) => void; label: string; className?: string; placeholder?: string;
  preserveLineEndings?: boolean;
  resetKey?: number;
  /**
   * 入力の上限（UTF-16 の単位）。渡すと、欄の下に「今の文字数 / 上限」を表示する（上限を USAGE.md を読まなくても分かるように）。
   * 上限を超えたときの扱い（エラーの表示）は、各ツールの計算の側で行う
   */
  limit?: number;
}) {
  const [showFull, setShowFull] = useState(false);
  const large = value.length > TEXT_PREVIEW_LIMIT;
  const preview = large && !showFull;
  const displayedText = preview ? textPreview(value, TEXT_PREVIEW_LIMIT) : value;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useLatest(value);
  const beforeEdit = useRef<(TextEditSelection & { source: string }) | null>(null);
  const history = useRef(new TextEditHistory(value));
  const [, refreshHistory] = useState(0);
  const composing = useRef(false);
  const compositionRecorded = useRef(false);
  const previousReset = useRef(resetKey);
  const pendingCaret = useRef<{ value: string; position: number } | null>(null);
  const syncHistory = () => {
    if (history.current.current !== value) history.current.reset(value);
  };
  const commit = (next: string, merge = false) => {
    syncHistory();
    history.current.record(next, merge);
    onChange(next);
  };
  const restore = (redo: boolean) => {
    if (composing.current || preview) return;
    syncHistory();
    beforeEdit.current = null;
    const next = redo ? history.current.redo() : history.current.undo();
    if (next !== null) onChange(next);
    refreshHistory((version) => version + 1);
  };
  const restoreRef = useLatest(restore);
  useLayoutEffect(() => {
    /** ファイル読み込み・サンプル・消去など、欄外からの変更は履歴を破棄する。 */
    if (previousReset.current !== resetKey || history.current.current !== value) {
      previousReset.current = resetKey;
      history.current.reset(value);
      beforeEdit.current = null;
      pendingCaret.current = null;
      compositionRecorded.current = false;
      refreshHistory((version) => version + 1);
    }
  }, [value, resetKey]);
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    pendingCaret.current = null;
    if (pending?.value === value && !preview) inputRef.current?.setSelectionRange(pending.position, pending.position);
  });
  useEffect(() => { if (!large) setShowFull(false); }, [large]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    /** React の合成 beforeinput で扱われない削除操作も、ブラウザのネイティブイベントで取得する。 */
    const capture = (event: InputEvent) => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        if (composing.current || event.isComposing) return;
        if (event.cancelable) {
          event.preventDefault();
          restoreRef.current(event.inputType === 'historyRedo');
          return;
        }
      }
      beforeEdit.current = { source: sourceRef.current, start: input.selectionStart, end: input.selectionEnd, inputType: event.inputType };
    };
    input.addEventListener('beforeinput', capture);
    return () => input.removeEventListener('beforeinput', capture);
  }, []);
  return (
    <>
      {large && <div>
        <p className="hint">大きな入力のため、通常は先頭{TEXT_PREVIEW_LIMIT_LABEL}文字相当のみ表示します。計算・保存には全文を使います。この欄からのコピーは表示部分だけです。</p>
        <div className="toolbar">
          <CopyButton text={value} label="入力全文をコピー" />
          <button type="button" className="btn btn-ghost" onClick={() => setShowFull((current) => !current)}>
            {showFull ? 'プレビューに戻す' : '全文を編集'}
          </button>
        </div>
        {showFull && <p className="hint">全文の表示・編集は、データ量によって時間がかかる場合があります。</p>}
      </div>}
      <div className="toolbar">
        <button type="button" className="btn btn-ghost" disabled={preview || !history.current.canUndo} onClick={() => restore(false)}>元に戻す</button>
        <button type="button" className="btn btn-ghost" disabled={preview || !history.current.canRedo} onClick={() => restore(true)}>やり直す</button>
      </div>
      <textarea
        ref={inputRef}
        aria-label={label} className={className} spellCheck={false} wrap="off" placeholder={placeholder}
        readOnly={preview} value={preserveLineEndings ? displayedText.replace(/\r\n?/g, '\n') : displayedText}
        onCompositionStart={() => { composing.current = true; compositionRecorded.current = false; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.altKey || composing.current || isImeComposing(event)) return;
          const key = event.key.toLowerCase();
          if ((event.ctrlKey || event.metaKey) && (key === 'z' || (event.ctrlKey && key === 'y'))) {
            event.preventDefault();
            restore(key === 'y' || event.shiftKey);
          }
        }}
        onChange={(event) => {
          const edit = beforeEdit.current;
          beforeEdit.current = null;
          if (preview) return;
          if (edit?.inputType === 'historyUndo' || edit?.inputType === 'historyRedo') {
            restore(edit.inputType === 'historyRedo');
            return;
          }
          const composition = composing.current || !!edit?.inputType.includes('Composition');
          commit(preserveLineEndings ? applyTextEdit(value, event.target.value, edit?.source === value ? edit : undefined) : event.target.value,
            composition && compositionRecorded.current);
          compositionRecorded.current = composition;
        }}
        onPaste={(event) => {
          if (preview) return;
          /** 画像やファイルだけの貼り付けで、選択中の文字を空文字へ置き換えない。 */
          if (!event.clipboardData.types.includes('text/plain') && !event.clipboardData.types.includes('text')) return;
          const pasted = event.clipboardData.getData('text');
          const input = event.currentTarget;
          if (!preserveLineEndings && value.length - (input.selectionEnd - input.selectionStart) + pasted.length <= TEXT_PREVIEW_LIMIT) return;
          event.preventDefault();
          beforeEdit.current = null;
          compositionRecorded.current = false;
          const next = replaceTextSelectionWithCaret(value, input.selectionStart, input.selectionEnd, pasted);
          pendingCaret.current = { value: next.value, position: next.caret };
          commit(next.value);
        }}
      />
      {limit !== undefined && (
        <p className="hint">
          {formatNumber(value.length)} / {formatNumber(limit)} 文字
          {value.length > limit && '（上限を超えています）'}
        </p>
      )}
    </>
  );
}
