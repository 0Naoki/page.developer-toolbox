import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { useLatest } from './useLatest';
import { isClearingData, pruneInvalidSetting, readStoredSetting, storedSettingUpdateBase, settingStorageKey, settingValueFromEvent, writeStoredSetting } from '../lib/storage';
import { readSetting, type SettingKey, type SettingValidator } from '../lib/settings';

/**
 * 検証済みの表示設定を localStorage に保存する。
 *
 * @remarks
 * 保存領域を使えなくてもメモリ内の状態で動作する。入力内容や機密値には使わない（入力は useInput）。
 * 名前は保存先（localStorage）ではなく用途（表示設定。保存キーの pref: の名前空間）を表す。
 * 保存するのは、利用者が更新関数で値を変えたときだけ。復元・別タブからの通知・再描画では保存しない
 * （別タブで変えた設定を、このタブの古い値で書き戻さないため）。更新関数を渡したときは、保存値を読み直してから適用する。
 * 初期値と同じ値は保存キーを削除する。
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
      return readStoredSetting(localStorage, storageKey, initial, validate);
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

  /** 直前の保存に失敗したか（このタブの値が、保存値より新しい） */
  const unsaved = useRef(false);

  /**
   * 更新関数（`setX((previous) => …)`）に渡す、元の値。
   *
   * @remarks
   * 別タブの変更を受け取らない設定（syncTabs が false）では、このタブの値が古いことがある。古い値に更新関数を適用して保存すると、
   * 別タブが保存した値を上書きする（「最近使ったツール」が、別タブで開いたツールを消すなど）。そこで、保存値を読み直して適用する。
   * ただし、このタブの値が検証に通らない途中の値（画面にだけ持つ値）のときや、直前の保存に失敗したときは、このタブの値の方が新しいため、それを使う。
   * 検証に通る値は変えたときに保存しているので、保存値と違えば、保存値の方が新しい。
   */
  const previousForUpdate = useCallback((): T => {
    const current = latest.current;
    try {
      return storedSettingUpdateBase(localStorage, storageKey, current, initialRef.current, validateRef.current, unsaved.current || isClearingData());
    } catch {
      return current;
    }
  }, [storageKey, latest, validateRef, initialRef]);

  const update = useCallback((action: SetStateAction<T>) => {
    const next = typeof action === 'function' ? (action as (previous: T) => T)(previousForUpdate()) : action;
    latest.current = next;
    setValue(next);
    if (isClearingData()) return;
    try {
      writeStoredSetting(localStorage, storageKey, JSON.stringify(next), initialJson, validateRef.current);
      unsaved.current = false;
    } catch {
      /** 保存できなくても動作は継続 */
      unsaved.current = true;
    }
  }, [storageKey, initialJson, latest, validateRef, previousForUpdate]);

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
