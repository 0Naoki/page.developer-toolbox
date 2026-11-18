import type { Certificate } from './logic';

/** 証明書の有効期間の評価。解析と署名検証から独立した、現在時刻に対する判定。 */

export type Validity = { status: 'notYet' | 'expired' | 'soon' | 'valid'; daysLeft: number };

/** 有効期限の状態。残り30日以内は soon */
export function validityOf(cert: Pick<Certificate, 'notBefore' | 'notAfter'>, now: number = Date.now()): Validity {
  const daysLeft = Math.floor((cert.notAfter.getTime() - now) / 86400000);
  if (now < cert.notBefore.getTime()) return { status: 'notYet', daysLeft };
  /** 期限切れは過ぎた日数を切り捨てて数える（切り下げると、2分過ぎただけで「1日前」になる）。daysLeft は 0 以下 */
  if (now > cert.notAfter.getTime()) {
    const daysAgo = Math.floor((now - cert.notAfter.getTime()) / 86400000);
    return { status: 'expired', daysLeft: daysAgo === 0 ? 0 : -daysAgo }; /** -0 にしない */
  }
  return { status: daysLeft <= 30 ? 'soon' : 'valid', daysLeft };
}
