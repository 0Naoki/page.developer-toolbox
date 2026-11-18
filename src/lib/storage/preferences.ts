/**
 * 表示設定（usePreference）の保存キーと、起動時の保存領域の整理。
 *
 * @remarks
 * 表示設定は `dev-toolbox:pref:<キー>` に保存する。ツールの設定のキーは先頭をツール ID にする（`pref:json:indent` など）。
 * 設定の保存はロックを取らず、その設定のキーだけを操作する（別タブが同時に変えたほかの設定を上書きしないため）。
 */

import { APP_SETTING_KEYS, isValidSetting, readSetting, settingUpdateBase, type SettingKey, type SettingValidator } from '../settings';
import { APP_PREFIX, CLEAR_KEY, INPUT_PREFIX, keysOf, PREF_PREFIX, safe, TAB_GENERATION_KEY, type StorageLike } from './io';

/** 表示設定の保存キー（`dev-toolbox:pref:<キー>`） */
export const settingStorageKey = (key: SettingKey): string => PREF_PREFIX + key;

/** 保存領域を参照できなければ既定値を返す。復元は保存を伴わない。 */
export function readStoredSetting<T>(storage: Pick<Storage, 'getItem'> | null, key: string, initial: T, validate: SettingValidator<T>): T {
  return safe(() => readSetting(storage?.getItem(key) ?? null, initial, validate), initial);
}

/** 別タブの保存値を更新の基準にする。読み取れない場合や未保存の変更がある場合は現在値を使う。 */
export function storedSettingUpdateBase<T>(storage: Pick<Storage, 'getItem'> | null, key: string, current: T, initial: T, validate: SettingValidator<T>, keepCurrent: boolean): T {
  if (!storage || keepCurrent) return current;
  return safe(() => settingUpdateBase(current, storage.getItem(key), initial, validate, false), current);
}

/** 値を保存する。初期値へ戻す場合はキーを消す。検証に通らない途中の値では保存領域に触れない。 */
export function writeStoredSetting<T>(storage: Pick<Storage, 'setItem' | 'removeItem'>, storageKey: string, raw: string, initialJson: string, validate: SettingValidator<T>): void {
  if (raw === initialJson) storage.removeItem(storageKey);
  else if (isValidSetting(raw, validate)) storage.setItem(storageKey, raw);
}

/** 復元できない値なら消す（次の起動に持ち越さない）。 */
export function pruneInvalidSetting<T>(storage: Pick<Storage, 'getItem' | 'removeItem'>, storageKey: string, validate: SettingValidator<T>): void {
  const raw = storage.getItem(storageKey);
  if (raw !== null && !isValidSetting(raw, validate)) storage.removeItem(storageKey);
}

/**
 * この設定に関係する localStorage の通知なら、現在の値を読み直す。
 * @returns 関係のない通知は null。関連通知の raw が null なら、設定が消えて初期値へ戻った。
 */
export function settingValueFromEvent(
  storage: Pick<Storage, 'getItem'>, storageKey: string,
  event: { key: string | null; storageArea: Pick<Storage, 'getItem'> | null },
): { raw: string | null } | null {
  if (event.storageArea !== storage || (event.key !== null && event.key !== storageKey)) return null;
  return { raw: storage.getItem(storageKey) };
}

/**
 * 起動時に、今の形式で使わないキーを保存領域から消す。
 *
 * @remarks
 * - localStorage：今あるツール・アプリ全体の表示設定（`pref:`）と消去世代だけを残す。削除したツールの設定や、
 *   以前の版が残したキー（localStorage に保存していた入力・「入力内容を保存する」設定・名前空間のない表示設定など）は消す。
 *   以前の版の入力が localStorage に残っていると、同じオリジンのほかのサイトから読めるため（SECURITY.md）。
 * - sessionStorage：今あるツールの入力（`input:<ツールID>…`）と、入力を保存した消去世代だけを残す。
 *
 * 画面から消せないまま残り続けるのを防ぐためで、移し替えはしない。1つのキーを消せなくても、残りの確認は続ける。
 *
 * @param local - localStorage。参照できない環境では null（もう片方の整理は続ける）。
 * @param session - sessionStorage。参照できない環境では null。
 * @param toolIds - ツールの一覧にある全ツールの ID。
 * @param inputToolIds - 入力を保存するツールの ID。
 */
export function pruneStaleKeys(local: StorageLike | null, session: StorageLike | null, toolIds: readonly string[], inputToolIds: readonly string[]): void {
  const rootOf = (name: string) => name.split(':', 1)[0] ?? '';
  const isCurrentSetting = (key: string) => {
    if (!key.startsWith(PREF_PREFIX)) return false;
    const name = key.slice(PREF_PREFIX.length);
    return (APP_SETTING_KEYS as readonly string[]).includes(name) || toolIds.includes(rootOf(name));
  };
  const isCurrentInput = (key: string) => key.startsWith(INPUT_PREFIX) && inputToolIds.includes(rootOf(key.slice(INPUT_PREFIX.length)));
  if (local) {
    for (const key of safe(() => keysOf(local, APP_PREFIX), [])) {
      if (key !== CLEAR_KEY && !isCurrentSetting(key)) safe(() => local.removeItem(key), undefined);
    }
  }
  if (session) {
    for (const key of safe(() => keysOf(session, APP_PREFIX), [])) {
      if (key !== TAB_GENERATION_KEY && !isCurrentInput(key)) safe(() => session.removeItem(key), undefined);
    }
  }
}
