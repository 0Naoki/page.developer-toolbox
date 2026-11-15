/**
 * 保存領域（localStorage・sessionStorage）の入口。src/lib/storage/ の外からは、このファイルだけを読み込む（静的検査あり）。
 *
 * @remarks
 * フォルダの中の分担：
 * - `io.ts`：保存キーの名前と低水準の読み書き（ロックも消去世代の確認もしない）
 * - `inputCatalog.ts`：入力を保存するツールの ID と入力キー
 * - `clear.ts`：全消去と消去世代。`lock.ts`：タブ間のロック
 * - `preferences.ts`：表示設定（usePreference）の保存キーと読み書き、起動時の古いキーの整理
 * - `inputSaveFailures.ts`：保存に失敗した入力の一覧（画面の通知用）
 *
 * 入力内容の保存先は、常に sessionStorage（タブごと）。ツールを切り替えても再読み込みしても残るが、タブを閉じると消える。
 * localStorage には入力を保存しない。GitHub Pages では、同じアカウント（または組織）のサイトがすべて同じオリジンになり、
 * localStorage を共有するため（同じオリジンのほかのサイトから、いつでも読める）。
 *
 * 表示設定（インデント幅など）は機密ではないため、localStorage に保存する（usePreference）。
 */

import { INPUT_PREFIX, safe } from './io';
import { INPUT_TOOLS, type InputKey } from './inputCatalog';
import { discardClearedTabData, isClearingData } from './clear';
import { pruneStaleKeys } from './preferences';

/**
 * 画面・フックに公開するのは、ロック付きの操作と、読み取りに使う名前だけ。
 * ロックも消去世代の記録もしない clearAppData などは公開しない（全消去や別タブの保存の決まりを迂回させない）
 */
export { APP_PREFIX } from './io';
export { INPUT_TOOLS, type InputToolId, type InputKey } from './inputCatalog';
export { isClearingData, subscribeClearData, clearAllData } from './clear';
export { getInputSaveFailures, hasInputSaveFailure, setInputSaveFailure, subscribeInputSaveFailures, type InputSaveFailure } from './inputSaveFailures';
/** 表示設定は入力と違い、ロックを取らない（利用者が値を変えたときだけ、その設定のキーへ書く） */
export { pruneInvalidSetting, settingStorageKey, settingValueFromEvent, writeStoredSetting } from './preferences';

/**
 * 起動時に、描画の前に呼ぶ。
 * - このタブを離れていた間に全消去されていたら、このタブの入力を捨てる（{@link discardClearedTabData}）
 * - 今の形式で使わないキー（削除したツールの入力と表示設定、以前の版が残したキー）を消す
 *   （{@link pruneStaleKeys}。画面から消せないまま残り続けないように）
 *
 * localStorage・sessionStorage を参照するだけで例外になる環境（保存を禁止したブラウザ）でも、起動を止めない。
 *
 * @param toolIds - ツールの一覧にある全ツールの ID（表示設定の整理に使う）。
 */
export function prepareStorage(toolIds: readonly string[]): void {
  const local = safe(() => localStorage, null);
  const session = safe(() => sessionStorage, null);
  discardClearedTabData(local, session);
  pruneStaleKeys(local, session, toolIds, INPUT_TOOLS);
}

/** このタブの保存領域から入力を復元する。保存領域を読めない場合は初期値に戻す。 */
export function readInput(key: InputKey, initial: string): string {
  return safe(() => sessionStorage.getItem(INPUT_PREFIX + key) ?? initial, initial);
}

/**
 * 明示的に編集した値を、このタブの保存領域（sessionStorage）に書く。初期値に戻したときは、キーを消す。
 *
 * 全消去の途中では書かない。sessionStorage はタブごとなので、別タブとのロックは取らない。
 *
 * @returns 保存領域に書いたか。全消去の途中で書かなかったときは false（未保存の通知を消さないため）。
 * @throws 保存できないとき（容量超過・保存を禁止したブラウザ）。呼び出し側で、未保存の入力として利用者に示す。
 */
export function saveInput(key: InputKey, value: string, initial: string): boolean {
  if (isClearingData()) return false;
  if (value === initial) sessionStorage.removeItem(INPUT_PREFIX + key);
  else sessionStorage.setItem(INPUT_PREFIX + key, value);
  return true;
}
