/** 消去結果。共有領域が未確認なら、再試行で他タブの新しい値を削除してはいけない。 */
export type ClearResult = { ok: true } | { ok: false; retry: () => void; sharedPending: boolean };
export type ClearListener = (result: ClearResult) => void;
export type ClearPhase = 'ready' | 'clearing' | 'failed' | 'complete';

/**
 * 消去の状態と通知だけを管理する。Storage とブラウザイベントには依存しない。
 * 成功後も再読み込みまでは保存を止め、起動時の失敗は後から購読する画面にも渡す。
 */
export function createClearLifecycle() {
  let phase: ClearPhase = 'ready';
  let result: ClearResult | null = null;
  const listeners = new Set<ClearListener>();
  return {
    get phase() { return phase; },
    get blocked() { return phase !== 'ready'; },
    begin() { phase = 'clearing'; },
    finish(next: ClearResult) {
      phase = next.ok ? 'complete' : 'failed';
      result = next;
      listeners.forEach((listener) => listener(next));
    },
    subscribe(listener: ClearListener) {
      listeners.add(listener);
      if (result) listener(result);
      return () => { listeners.delete(listener); };
    },
  };
}
