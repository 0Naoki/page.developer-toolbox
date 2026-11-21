import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { hasInputSaveFailure, isClearingData, readInput, saveInput, setInputSaveFailure, type InputKey } from '../lib/storage';

/**
 * 入力欄の内容を、このタブの保存領域（sessionStorage）に保持する。
 *
 * @remarks
 * ツールを切り替えても再読み込みしても残り、タブを閉じると消える。localStorage には保存しない
 * （理由は src/lib/storage/index.ts の先頭を参照）。
 * 明示的な編集時に保存し、保存に失敗した入力はメモリ内に保持して退避・再試行の対象にする。
 * JWT や鍵など、保存してはいけない値には使わない。
 *
 * @param key - 入力を保存するツール（ツールの一覧で `savesInput: true`）の入力キー。接頭辞は内部で付ける。
 * @param initial - 保存値がない場合の初期値。この値に戻すと保存キーを削除する。
 * @returns 現在の入力と、状態更新・保存を行う更新関数の組。
 */
export function useInput(key: InputKey, initial = '') {
  const [value, setInput] = useState(() => readInput(key, initial));
  const latestInput = useRef(value);
  const failureId = useRef(Symbol(key)).current;
  /** 保存の直前の全消去の確認は saveInput の中で行う（消去世代を読み直すため）。setValue の isClearingData は、全消去の途中にこのタブのメモリの値を変えないためのもの */
  const save = useCallback((next: string) => {
    try {
      if (saveInput(key, next, initial) && hasInputSaveFailure(failureId)) setInputSaveFailure(failureId, null);
    } catch {
      setInputSaveFailure(failureId, { id: failureId, read: () => latestInput.current, retry: () => save(latestInput.current) });
    }
  }, [failureId, initial, key]);
  useEffect(() => () => setInputSaveFailure(failureId, null), [failureId]);
  /** 初期表示では保存先に書かない。明示的な編集時だけ書く。 */
  const setValue = useCallback((update: SetStateAction<string>) => {
    if (isClearingData()) return;
    /** React の状態更新関数の中では書かない（StrictMode の再実行で副作用を繰り返さないため）。 */
    const next = typeof update === 'function' ? update(latestInput.current) : update;
    latestInput.current = next;
    setInput(next);
    save(next);
  }, [save]);

  return [value, setValue] as const;
}
