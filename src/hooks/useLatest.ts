import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * 最後に画面へ反映した描画の値を、ref で持つ（イベント・タイマー・effect から、依存に入れずに最新の値を読むため）。
 *
 * @remarks
 * ref を描画中に書き換えると、React が描画をやり直したり捨てたりしたとき（StrictMode・並行描画）に、
 * 画面に出ていない描画の値が残る。そのため、画面への反映（commit）の直後に書き換える。
 * 返す ref は描画中に読まない（描画には value をそのまま使う）。
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
