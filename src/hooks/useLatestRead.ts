import { useEffect, useMemo, useRef } from 'react';

/** start が返す、その読み込みがまだ最新かを確かめる関数 */
export type IsCurrent = () => boolean;

/**
 * ファイルの読み込みなどの非同期処理のうち、最後に始めたものの結果だけを反映する。
 *
 * @remarks
 * 新しい読み込みを始めたとき、cancel を呼んだとき（入力の編集・設定の変更など）、画面を離れたときに、
 * それより前の読み込みを無効にする。失敗したときに入力を残すか消すかなど、結果の扱いは呼び出し側で決める。
 *
 * @returns start（読み込みを始め、まだ最新かを確かめる関数を返す）と cancel（進行中の読み込みを無効にする）。
 *   どちらも描画のたびに変わらない。
 */
export function useLatestRead() {
  const latest = useRef(0);
  useEffect(() => () => { latest.current++; }, []);
  return useMemo(() => ({
    start: (): IsCurrent => {
      const id = ++latest.current;
      return () => id === latest.current;
    },
    cancel: () => { latest.current++; },
  }), []);
}
