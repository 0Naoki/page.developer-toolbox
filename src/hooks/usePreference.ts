import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import { useLatest } from './useLatest';
import { isClearingData, pruneInvalidSetting, settingStorageKey, settingValueFromEvent, writeStoredSetting } from '../lib/storage';
import { readSetting, type SettingKey, type SettingValidator } from '../lib/settings';

/**
 * 検証済みの表示設定を localStorage に保存する。
 *
 * @remarks
 * 保存領域を使えなくてもメモリ内の状態で動作する。入力内容や機密値には使わない（入力は useInput）。
 * 名前は保存先（localStorage）ではなく用途（表示設定。保存キーの pref: の名前空間）を表す。
 * 保存するのは、利用者が更新関数で値を変えたときだけ。復元・別タブからの通知・再描画では保存しない
 * （別タブで変えた設定を、このタブの古い値で書き戻さないため）。初期値と同じ値は保存キーを削除する。
 * 保存も復元と同じ `validate` を通る値だけに限り、通らない値の間は画面にだけ持ち、直前に保存した値を残す。
 * 保存キーは `dev-toolbox:pref:<key>`。
 *
 * @typeParam T - 表示設定の型。
 * @param key - アプリの接頭辞を除いた設定キー。ツールの設定は先頭をツール ID にする。
 * @param initial - 保存値がない場合、または検証に失敗した場合の初期値。
 * @param validate - 保存値の型・選択肢・範囲を検証する関数。描画ごとに作り直してもよい。
 * @param syncTabs - 別タブからの設定変更も受け取るか。既定は false。
 * @returns 現在の設定値と更新関数の組。
 */
export function usePreference<T>(key: SettingKey, initial: T, validate: SettingValidator<T>, syncTabs = false) {
  /** key から決まる値なので、key が変わったときだけ作り直す（effect の依存にするため） */
  const storageKey = useMemo(() => settingStorageKey(key), [key]);
  const [value, setValue] = useState<T>(() => {
    try {
      return readSetting(localStorage.getItem(storageKey), initial, validate);
    } catch {
      return initial;
    }
  });
  /**
   * 更新関数とイベントからは、描画ごとに変わり得る値を参照で読む（依存に入れて処理をやり直さないため）。
   * latest は、同じイベントの中で続けて更新したときに前の更新を引き継ぐよう、更新関数の中でも書き換える
   */
  const latest = useLatest(value);
  const validateRef = useLatest(validate);
  const initialRef = useLatest(initial);
  const initialJson = JSON.stringify(initial);

  /** 検証を通らない保存値は、復元時に既定値へ戻したうえで消す（次の起動に持ち越さない）。有効な値は書き直さない */
  useEffect(() => {
    if (isClearingData()) return;
    try { pruneInvalidSetting(localStorage, storageKey, validateRef.current); } catch {
      /** 保存領域を参照できなくても動作は継続 */
    }
  }, [storageKey]);

  const update = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === 'function' ? (action as (previous: T) => T)(latest.current) : action;
    latest.current = next;
    setValue(next);
    if (isClearingData()) return;
    try {
      writeStoredSetting(localStorage, storageKey, JSON.stringify(next), initialJson, validateRef.current);
    } catch {
      /** 保存できなくても動作は継続 */
    }
  }, [storageKey, initialJson, latest, validateRef]);

  useEffect(() => {
    if (!syncTabs) return;
    /** 別タブの値を表示に反映するだけで、ここでは保存しない。読んだ値が今の値と同じなら、描画し直さない */
    const show = (raw: string | null) => {
      const next = readSetting(raw, initialRef.current, validateRef.current);
      setValue((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
    };
    const onStorage = (event: StorageEvent) => {
      try {
        const stored = settingValueFromEvent(localStorage, storageKey, event);
        if (stored) show(stored.raw);
      } catch {
        /** 保存領域を参照できなくても現在の表示を保つ */
      }
    };
    window.addEventListener('storage', onStorage);
    /**
     * 最初の描画で保存値を読んでから、ここで受け取りを登録するまでの間に別タブで変わった値は、通知が届かない。
     * 登録の直後に読み直して、その間の変更も反映する（タブを開いた直後に別タブで設定を変えると、古い表示のまま残るため）
     */
    try {
      show(localStorage.getItem(storageKey));
    } catch {
      /** 保存領域を参照できなくても現在の表示を保つ */
    }
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey, initialJson, syncTabs]);

  return [value, update] as const;
}
