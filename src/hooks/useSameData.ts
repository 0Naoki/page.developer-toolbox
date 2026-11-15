import { useRef } from 'react';
import { sameData } from '../lib/sameData';

/**
 * 前の描画の値と中身が同じ（{@link sameData}）なら、前の値の参照を返す。
 *
 * @remarks
 * 計算の要求・非同期の計算の key を、呼び出し側が描画のたびに作り直しても（useMemo を忘れても）、
 * 同じ入力で計算を始め直さないようにする。参照で比べる effect の依存に渡す前に通す。
 *
 * 描画中に ref を書き換える、このリポジトリで唯一の箇所（ほかは useLatest で画面への反映の後に書く）。
 * 捨てられた描画の値が ref に残っても、返すのは「今の値」か「今の値と中身が同じ値」のどちらかなので、結果は変わらない。
 * state に持って描画中に更新する書き方は使わない。クラスのインスタンスなど中身を比べない値を、呼び出し側が描画のたびに
 * 作り直すと、毎回「違う」と判定されて描画をやり直し続ける（Too many re-renders）ため。
 */
export function useSameData<T>(value: T): T {
  const previous = useRef(value);
  if (!sameData(previous.current, value)) previous.current = value;
  return previous.current;
}
