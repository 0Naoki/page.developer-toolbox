import { APP_PREFIX, CLEAR_KEY, clearAppData, keysOf, safe, type StorageLike } from './io';

/** 消去を始めたタブで未完了の操作。世代記録の失敗も、成功とは扱わない。 */
export type ClearState = { local: Set<string> | 'unknown'; session: boolean; recorded: boolean };

/**
 * 消去のI/O。保存領域と世代記録を注入し、開始時の削除と再試行時の確認を分ける。
 * 再試行では共有キーを消さず、世代も更新しない。他タブが消去後に保存した値を守るため。
 */
export function createClearOperations(io: { local: () => StorageLike; session: () => StorageLike; recordGeneration: () => boolean }) {
  const sharedKeys = () => keysOf(io.local(), APP_PREFIX).filter((key) => key !== CLEAR_KEY);
  const clearTab = () => safe(() => clearAppData(io.session()), false);
  return {
    clearTab,
    start(): ClearState {
      let recorded = io.recordGeneration();
      const keys = safe(sharedKeys, null);
      /** 消せなかったキーだけを残す（再試行で、消えたかを確かめる） */
      const local: ClearState['local'] = keys === null
        ? 'unknown'
        : new Set(keys.filter((key) => !safe(() => { io.local().removeItem(key); return true; }, false)));
      const session = clearTab();
      if (!recorded) recorded = io.recordGeneration();
      return { local, session, recorded };
    },
    retry(state: ClearState): void {
      if (state.local === 'unknown') {
        if (safe(() => sharedKeys().length === 0, false)) state.local = new Set();
      } else {
        for (const key of state.local) {
          if (safe(() => io.local().getItem(key) === null, false)) state.local.delete(key);
        }
      }
      if (!state.session) state.session = clearTab();
    },
  };
}
