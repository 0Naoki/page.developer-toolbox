import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorText } from './ErrorMessage';
import { useLatest } from '../hooks/useLatest';

/**
 * コピーの状態を対象と操作に対応させ、古い完了やタイマーを新しい値に反映しない。
 * @param text - 本文、または操作時だけ本文を作る同期関数。関数は useCallback などで対象ごとに参照を固定する。
 * @remarks 本文の生成も失敗表示・再試行の対象に含める。非同期の準備を挟まず、利用者の操作中に書き込む。
 */
export function CopyButton({ text, label = 'コピー' }: { text: string | (() => string); label?: string }) {
  const target = useMemo(() => ({ text }), [text]);
  const latestTarget = useLatest(target);
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<{ target: typeof target; phase: 'pending' | 'copied' | 'failed' } | null>(null);
  const phase = state?.target === target ? state.phase : 'idle';
  useEffect(() => {
    setState(null);
    return () => {
      version.current++;
      clearTimeout(timer.current);
    };
  }, [target]);

  const copy = async () => {
    const request = ++version.current;
    clearTimeout(timer.current);
    const current = () => version.current === request && latestTarget.current === target;
    setState({ target, phase: 'pending' });
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
      if (!current()) return;
      setState({ target, phase: 'copied' });
      timer.current = setTimeout(() => { if (current()) setState(null); }, 1200);
    } catch {
      if (current()) setState({ target, phase: 'failed' });
    }
  };

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={copy} disabled={!text || phase === 'pending'} aria-busy={phase === 'pending'} aria-live="polite">
        {phase === 'copied' ? 'コピーしました' : phase === 'pending' ? 'コピー中…' : label}
      </button>
      {phase === 'failed' && <ErrorText as="span" alert message="コピーできませんでした。ブラウザの権限を確認して、もう一度コピーしてください。" />}
    </>
  );
}
