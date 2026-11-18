import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CopyButton } from './CopyButton';
import { TEXT_PREVIEW_LIMIT, textPreview } from '../lib/text/textPreview';
import { applyTextEdit, replaceTextSelectionWithCaret, TextEditHistory, type TextEditSelection } from '../lib/text/textEdit';
import { isImeComposing } from '../lib/keyboard';
import { useLatest } from '../hooks/useLatest';
import { formatNumber } from '../lib/number';
import { useTextInputMode } from '../hooks/useTextInputMode';

/**
 * 大きな入力は全文を状態に保持し、ネイティブ textarea の大量レイアウトを避ける。
 * 大きな貼り付けは部品が自分で入力を置き換えてブラウザの編集履歴に残らないため、元に戻す・やり直すは
 * 改行を保持するかどうかに関係なく、部品の履歴（TextEditHistory）で行う。
 */
export function LargeTextInput({ value, onChange, label, className = 'code', placeholder, preserveLineEndings = false, resetKey = 0, limit, previewLimit = TEXT_PREVIEW_LIMIT }: {
  value: string; onChange: (value: string) => void; label: string; className?: string; placeholder?: string;
  preserveLineEndings?: boolean;
  resetKey?: number;
  /**
   * 入力の上限（UTF-16 の単位）。渡すと、欄の下に「今の文字数 / 上限」を表示する（上限を USAGE.md を読まなくても分かるように）。
   * 上限を超えたときの扱い（エラーの表示）は、各ツールの計算の側で行う
   */
  limit?: number;
  /** 表示の上限。入力・保存の上限とは別。多種類の文字を含む設定欄は少なめにする。 */
  previewLimit?: number;
}) {
  const large = value.length > previewLimit;
  const mode = useTextInputMode(large);
  const preview = mode.preview;
  const displayedText = preview ? textPreview(value, previewLimit) : value;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useLatest(value);
  const beforeEdit = useRef<(TextEditSelection & { source: string }) | null>(null);
  const history = useRef(new TextEditHistory(value));
  const [, refreshHistory] = useState(0);
  const compositionRecorded = useRef(false);
  const previousReset = useRef(resetKey);
  const pendingCaret = useRef<{ value: string; position: number } | null>(null);
  const syncHistory = () => {
    if (history.current.current !== value) history.current.reset(value);
  };
  const commit = (next: string, merge = false) => {
    /** 同じタスクの compositionend と input は、描画前でも同じ履歴へ記録する。 */
    history.current.record(next, merge);
    onChange(next);
  };
  const acceptEdit = (text: string) => {
    const edit = beforeEdit.current;
    beforeEdit.current = null;
    const composition = mode.isComposing() || !!edit?.inputType.includes('Composition');
    const original = history.current.current;
    const next = preserveLineEndings ? applyTextEdit(original, text, edit?.source === original ? edit : undefined) : text;
    if (next === original) return;
    commit(next, composition && compositionRecorded.current);
    compositionRecorded.current = composition;
  };
  const restore = (redo: boolean) => {
    if (mode.isComposing() || preview) return;
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
      mode.reset();
      refreshHistory((version) => version + 1);
    }
  }, [value, resetKey]);
  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    pendingCaret.current = null;
    if (pending?.value === value && !preview) inputRef.current?.setSelectionRange(pending.position, pending.position);
  });
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    /** React の合成 beforeinput で扱われない削除操作も、ブラウザのネイティブイベントで取得する。 */
    const capture = (event: InputEvent) => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        if (mode.isComposing() || event.isComposing) return;
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
        <p className="hint">大きな入力のため、通常は先頭{formatNumber(previewLimit)}文字相当のみ表示します。計算・保存には全文を使います。この欄からのコピーは表示部分だけです。</p>
        <div className="toolbar">
          <CopyButton text={value} label="入力全文をコピー" />
          <button type="button" className="btn btn-ghost" disabled={mode.composing} onClick={mode.toggleFull}>
            {mode.full ? 'プレビューに戻す' : '全文を編集'}
          </button>
        </div>
        {mode.full && <p className="hint">全文の表示・編集は、データ量によって時間がかかる場合があります。</p>}
      </div>}
      <div className="toolbar">
        <button type="button" className="btn btn-ghost" disabled={preview || mode.composing || !history.current.canUndo} onClick={() => restore(false)}>元に戻す</button>
        <button type="button" className="btn btn-ghost" disabled={preview || mode.composing || !history.current.canRedo} onClick={() => restore(true)}>やり直す</button>
      </div>
      <textarea
        ref={inputRef}
        aria-label={label} className={className} spellCheck={false} wrap="off" placeholder={placeholder}
        readOnly={preview} value={preserveLineEndings ? displayedText.replace(/\r\n?/g, '\n') : displayedText}
        onCompositionStart={() => { mode.begin(); compositionRecorded.current = false; }}
        onCompositionEnd={(event) => {
          if (!mode.isComposing()) return;
          /** 終了時に DOM が先に確定済みになるブラウザでも、切り詰める前に全文を取り込む。 */
          acceptEdit(event.currentTarget.value);
          mode.end();
        }}
        onKeyDown={(event) => {
          if (event.altKey || mode.isComposing() || isImeComposing(event)) return;
          const key = event.key.toLowerCase();
          if ((event.ctrlKey || event.metaKey) && (key === 'z' || (event.ctrlKey && key === 'y'))) {
            event.preventDefault();
            restore(key === 'y' || event.shiftKey);
          }
        }}
        onChange={(event) => {
          if (preview) return;
          const edit = beforeEdit.current;
          if (edit?.inputType === 'historyUndo' || edit?.inputType === 'historyRedo') {
            restore(edit.inputType === 'historyRedo');
            return;
          }
          acceptEdit(event.target.value);
        }}
        onPaste={(event) => {
          if (preview) return;
          /** 画像やファイルだけの貼り付けで、選択中の文字を空文字へ置き換えない。 */
          if (!event.clipboardData.types.includes('text/plain') && !event.clipboardData.types.includes('text')) return;
          const pasted = event.clipboardData.getData('text');
          const input = event.currentTarget;
          if (!preserveLineEndings && value.length - (input.selectionEnd - input.selectionStart) + pasted.length <= previewLimit) return;
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
