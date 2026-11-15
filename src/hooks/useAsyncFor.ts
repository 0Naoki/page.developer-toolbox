import { useEffect, useState } from 'react';
import type { AsyncContext } from '../lib/asyncContext';
import { useSameData } from './useSameData';

/** useAsyncFor の結果。ready が false の間は計算中（または key が null）で、run が報告した途中経過を progress に持つ */
export type AsyncResult<T, P = never> = { ready: true; value: T } | { ready: false; progress: P | null };

type State<K, T, P> = { key: K; done: true; value: T } | { key: K; done: false; progress: P };

const NOT_READY: AsyncResult<never, never> = { ready: false, progress: null };

/**
 * key に対する非同期の計算（署名の検証・指紋・ハッシュなど）の結果を、key と組にして持つ。
 *
 * @remarks
 * 結果と途中経過は「どの key のものか」と一緒に持ち、描画のときに今の key と同じ（===）ときだけ返す。
 * そのため、入力を変えた直後の描画でも、前の入力の結果（「署名は正しい」など）や進捗を表示しない。
 * key が変わったとき・画面を離れたときは、進行中の計算の結果を捨てる。
 *
 * - key は作り直されても、中身が同じ（useSameData。配列と普通のオブジェクトは中身、それ以外は参照で比べる）なら計算し直さない。null なら計算しない
 * - run は key だけから結果を求める（ほかの値を使うと、その値が変わっても計算し直さない）
 *
 * @param onError run が失敗したときの結果（失敗を、計算中のまま残さない）
 * @param options.delay 計算を始めるまで待つミリ秒。入力のたびに重い計算を始めないよう、待つ間に key が変われば始めない
 */
export function useAsyncFor<K, T, P = never>(
  requestedKey: K | null,
  run: (key: K, context: AsyncContext<P>) => Promise<T>,
  onError: (error: unknown) => T,
  options: { delay?: number } = {},
): AsyncResult<T, P> {
  const key = useSameData(requestedKey);
  const [state, setState] = useState<State<K, T, P> | null>(null);
  const delay = options.delay ?? 0;
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const context: AsyncContext<P> = {
      isCancelled: () => cancelled,
      report: (progress) => { if (!cancelled) setState({ key, done: false, progress }); },
    };
    const start = () => {
      run(key, context).then(
        (value) => { if (!cancelled) setState({ key, done: true, value }); },
        (error: unknown) => { if (!cancelled) setState({ key, done: true, value: onError(error) }); },
      );
    };
    const timer = delay > 0 ? setTimeout(start, delay) : undefined;
    if (timer === undefined) start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    /** run と onError は key だけから結果を求めるため、key が変わったときだけ計算し直す（描画のたびに作り直される関数で再計算しない） */
  }, [key, delay]);
  if (key === null || state === null || state.key !== key) return NOT_READY;
  return state.done ? { ready: true, value: state.value } : { ready: false, progress: state.progress };
}
