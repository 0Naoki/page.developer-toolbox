import { useEffect, useRef, useState } from 'react';

/** 全文表示の選択と、変換開始から最終 input の取り込みまでを一緒に管理する。 */
type InputMode = { full: boolean; composition: 'idle' | 'active' | 'ending' };

/** IME の終了直後に届く input も受け取ってから、大容量入力のプレビューへ戻す。 */
export function useTextInputMode(large: boolean) {
  const [mode, setMode] = useState<InputMode>({ full: false, composition: 'idle' });
  /** 同じイベント処理内の beforeinput・input も、描画を待たずに現在の段階を読む。 */
  const current = useRef(mode);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => {
    clearTimeout(pending.current);
    pending.current = undefined;
  };
  const update = (next: InputMode) => {
    current.current = next;
    setMode(next);
  };
  const reset = () => {
    cancel();
    update({ ...current.current, composition: 'idle' });
  };
  useEffect(() => () => clearTimeout(pending.current), []);
  useEffect(() => {
    if (!large && current.current.full) update({ ...current.current, full: false });
  }, [large]);
  return {
    full: mode.full,
    composing: mode.composition !== 'idle',
    preview: large && !mode.full && mode.composition === 'idle',
    isComposing: () => current.current.composition !== 'idle',
    begin: () => {
      cancel();
      update({ ...current.current, composition: 'active' });
    },
    end: () => {
      cancel();
      update({ ...current.current, composition: 'ending' });
      /** compositionend の前後で異なるブラウザの input 順序を、同じ編集として取り込む。 */
      pending.current = setTimeout(reset, 0);
    },
    toggleFull: () => {
      if (current.current.composition !== 'idle') return;
      update({ ...current.current, full: !current.current.full });
    },
    reset,
  };
}
