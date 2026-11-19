import type { Certificate } from './logic';

/** 証明書の有効期間の評価。解析と署名検証から独立した、現在時刻に対する判定。 */

export type Validity = { status: 'notYet' | 'expired' | 'soon' | 'valid'; daysLeft: number };

const DAY_MS = 86400000;
/** 期限が近いと警告する残りの期間 */
const SOON_MS = 30 * DAY_MS;

/**
 * 有効期限の状態。残りが30日以内（ちょうど30日を含む）は soon。
 * daysLeft は表示用に切り捨てた日数で、30日と23時間でも30になるため、soon の判定には切り捨てる前の残り時間を使う
 */
export function validityOf(cert: Pick<Certificate, 'notBefore' | 'notAfter'>, now: number = Date.now()): Validity {
  const remaining = cert.notAfter.getTime() - now;
  const daysLeft = Math.floor(remaining / DAY_MS);
  if (now < cert.notBefore.getTime()) return { status: 'notYet', daysLeft };
  /**
   * 期限切れは過ぎた時間を日数に切り捨てて数える（切り下げると、2分過ぎただけで「1日前」になる）。daysLeft は 0 以下。
   * 0 は過ぎてから24時間未満で、暦の日付とは限らない（日付が変わる直前に切れたものを、翌日に開いても 0）
   */
  if (remaining < 0) {
    const daysAgo = Math.floor(-remaining / DAY_MS);
    return { status: 'expired', daysLeft: daysAgo === 0 ? 0 : -daysAgo }; /** -0 にしない */
  }
  return { status: remaining <= SOON_MS ? 'soon' : 'valid', daysLeft };
}
