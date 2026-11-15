export const APP_PREFIX = 'dev-toolbox:';
export const INPUT_PREFIX = `${APP_PREFIX}input:`;
/** 表示設定（usePreference）のキーの先頭。入力・消去世代と分ける */
export const PREF_PREFIX = `${APP_PREFIX}pref:`;
/** 入力を含まない消去世代。既存のタブが通知前でも世代を照合できるよう、共有領域に残す。 */
export const CLEAR_KEY = `${APP_PREFIX}event:clear`;
/**
 * このタブの sessionStorage の入力を、どの消去世代のときに保存したか（sessionStorage に置く。入力は含まない）。
 * 全消去の通知はアプリを開いているタブにしか届かないため、別のサイトへ移動していたタブに戻ったときや、
 * セッションの復元で戻ったときに、起動時に世代を照合して消去前の入力を捨てる（clear.ts の discardClearedTabData）。
 */
export const TAB_GENERATION_KEY = `${APP_PREFIX}event:tab-generation`;
export const CLEAR_CHANNEL = 'dev-toolbox:clear';
export type StorageLike = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

export const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const keysOf = (s: StorageLike, prefix: string): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  return keys;
};

/** このアプリの保存データを消す。keepKey（共有の消去世代）は残す。 */
export function clearAppData(storage: StorageLike, keepKey?: string): boolean {
  let success = true;
  for (const key of keysOf(storage, APP_PREFIX)) {
    if (key === keepKey) continue;
    if (!safe(() => { storage.removeItem(key); return true; }, false)) success = false;
  }
  return success;
}
