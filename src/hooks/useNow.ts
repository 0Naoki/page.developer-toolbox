import { useEffect, useState } from 'react';

/**
 * 現在時刻（ミリ秒）。intervalMs ごとに更新する。
 *
 * @param intervalMs - 更新の間隔（ミリ秒）。
 * @param enabled - false の間は更新を止める（値は止めたときのまま）。false から true に戻したときは、
 *   止まっていた古い時刻のまま計算しないよう、すぐに現在時刻にしてから更新を再開する。
 */
export function useNow(intervalMs = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
