/**
 * 暦の中間計算（通算日と年月日の変換）。Date・Intl に依存させず、壁時計の年月日と実際の時刻（エポックミリ秒）を区別して扱う。
 * src/lib/time/date.ts と src/lib/time/timezone.ts の addZonedElapsed も、この計算を使う。
 */

/**
 * 1970-01-01 からの日数（先発グレゴリオ暦。月は 1〜12、日はその月を超えてもよい）。
 * Date を使わず、範囲の端で時差の分だけ範囲外になる壁時計の日付も計算する。
 */
export function daysFromCivil(y: number, mo: number, d: number): number {
  const year = mo <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * ((mo + 9) % 12) + 2) / 5) + d - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * 1970-01-01 からの整数の日数を年月日に戻す。
 * 呼び出し側で、Date の範囲と期間の相殺に必要な約2.1億日以内の整数として扱う。
 * 400年周期と3月始まりの年で計算し、紀元前・西暦0年も Date に渡さずに扱う。
 */
export function civilFromDays(days: number): { y: number; mo: number; d: number } {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const month = Math.floor((5 * dayOfYear + 2) / 153);
  const d = dayOfYear - Math.floor((153 * month + 2) / 5) + 1;
  const mo = month + (month < 10 ? 3 : -9);
  return { y: year + (mo <= 2 ? 1 : 0), mo, d };
}
