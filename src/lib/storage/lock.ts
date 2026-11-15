/**
 * タブ間で、全消去（clear.ts）を直列化するためのロック名。
 *
 * @remarks
 * 別タブで同時に全消去を始めても、消去世代の記録と削除が交互に混ざらないようにする。
 * 入力の保存（sessionStorage）と表示設定の保存はロックを取らない。
 */
const STORAGE_LOCK = 'dev-toolbox:storage';

/** ロックの中の処理の結果。例外はロックの外へ持ち出してから投げ直す */
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * 保存領域を更新する。呼び出し側はロック取得後に設定を読み直す。
 *
 * @remarks
 * ロックの中の処理の例外（保存の容量超過など）は、ロックの外で投げ直す。Firefox は、LockManager の
 * コールバックから投げた例外を、返す Promise を reject するだけでなく、捕まえていない例外としても報告するため。
 * 呼び出し側から見た結果（例外なら reject）は変わらない。
 *
 * @param operation - ロック取得後に実行する同期処理。
 * @param fallback - ロックが利用できないときに許可する処理。
 */
export async function withStorageLock<T>(operation: () => T, fallback: () => T): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return fallback();
  const outcome = await locks.request(STORAGE_LOCK, (): Outcome<T> => {
    try {
      return { ok: true, value: operation() };
    } catch (error) {
      return { ok: false, error };
    }
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
