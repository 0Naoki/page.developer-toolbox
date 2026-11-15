import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchTools } from '../registry';
import { isImeComposing } from '../lib/keyboard';

type Props = { open: boolean; onClose: () => void };

/** Ctrl+K / ⌘K で開くツール検索 */
export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();
  const optionId = (i: number) => `${listId}-option-${i}`;
  const results = searchTools(query);

  useEffect(() => {
    if (!open) return;
    /** 閉じたときに、開く前に操作していた場所（「ツールを検索」ボタンなど）へフォーカスを戻す */
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  /**
   * 矢印キーで選んだ候補が一覧の外に出ないようにスクロールする。
   * マウスを乗せたときや開いた直後はスクロールしない（マウスの下で一覧が動かないように）
   */
  const scrollToActive = useRef(false);
  useEffect(() => {
    if (!scrollToActive.current) return;
    scrollToActive.current = false;
    document.getElementById(`${listId}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  if (!open) return null;

  const go = (id: string) => {
    navigate(`/${id}`);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    /**
     * 日本語入力（IME）の変換中の Enter や矢印キーは、変換の確定や候補選びに使われるので触らない。
     * Safari は確定の Enter を変換終了後に送るため、isComposing だけでなく keyCode 229 でも判定する（isImeComposing）
     */
    if (isImeComposing(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const last = Math.max(results.length - 1, 0);
      const next = e.key === 'ArrowDown' ? Math.min(active + 1, last) : Math.max(active - 1, 0);
      if (next !== active) {
        scrollToActive.current = true;
        setActive(next);
      }
    } else if (e.key === 'Enter' && results[active]) {
      go(results[active].id);
    } else if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Tab') {
      /** 検索ウィンドウの中で操作できるのは入力欄だけなので、Tab で後ろのページへ移らないようにする */
      e.preventDefault();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="ツールを検索" onMouseDown={(e) => e.stopPropagation()}>
        {/** 入力欄にフォーカスを置いたまま矢印キーで候補を選ぶので、選択中の候補を読み上げソフトに伝える */}
        <input
          ref={inputRef}
          className="palette-input"
          role="combobox"
          aria-label="ツールを検索"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[active] ? optionId(active) : undefined}
          placeholder="ツールを検索（例: jwt, 日時, base64）"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            /** 選択を先頭に戻すので、一覧も先頭までスクロールしておく */
            document.getElementById(listId)?.scrollTo({ top: 0 });
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list" role="listbox" id={listId} aria-label="検索結果">
          {results.map((t, i) => (
            <li
              key={t.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'palette-item active' : 'palette-item'}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(t.id)}
            >
              <span className="palette-name">{t.name}</span>
              <span className="palette-desc">{t.description}</span>
            </li>
          ))}
        </ul>
        {/**
          読み上げソフトは、あとから作られた要素の内容を読まないことが多いため、
          この要素はパレットを開いている間は常に置いておき、中の文言だけを切り替える
        */}
        <p role="status" className={results.length === 0 ? 'palette-empty' : 'visually-hidden'}>
          {results.length === 0 ? '該当するツールがありません' : ''}
        </p>
        <div className="palette-hint">↑↓ で選択　Enter で開く　Esc で閉じる</div>
      </div>
    </div>
  );
}
