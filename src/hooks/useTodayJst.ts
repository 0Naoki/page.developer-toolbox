import { useEffect, useState } from 'react';
import { msUntilNextJstDay, todayJst } from '../lib/time/date';

/**
 * 日本時間の今日の日付。日本時間の日付変更・タブの表示復帰・ウィンドウへのフォーカスで更新する。
 * 同じ日なら状態を変えず（再描画しない）、明示した日付入力は書き換えない。
 */
export function useTodayJst() {
  const [today, setToday] = useState(() => todayJst());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = Date.now();
      const next = todayJst(now);
      setToday((previous) => previous.y === next.y && previous.m === next.m && previous.d === next.d ? previous : next);
      timer = setTimeout(refresh, msUntilNextJstDay(now));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return today;
}
