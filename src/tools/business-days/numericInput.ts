import { MAX_BUSINESS_DAYS } from './logic';
/** 月内の営業日の順番の最大値。週末を設けない設定でも31日を超える月はない。 */
export const MAX_MONTH_ORDINAL = 31;

/** 自由入力を10進整数として読み、安全な整数と用途ごとの範囲を確認する。指数・小数・巨大な値を丸めない。 */
function readInteger(text: string, min: number, max: number, message: string): number {
  const source = text.trim();
  if (!/^[+-]?\d+$/.test(source)) throw new Error(message);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(message);
  return value;
}

/** 月内の第n営業日。空欄は任意列を表示しない。どの月でも存在しない32以上は入力誤りとして示す。 */
export const parseMonthOrdinal = (text: string): number | null => text.trim() === '' ? null :
  readInteger(text, 1, MAX_MONTH_ORDINAL, `第n営業日は1〜${MAX_MONTH_ORDINAL}の整数で入力してください`);

/** 基準日から前後させる営業日数。入力欄と計算関数で同じ上限を使う。 */
export const parseBusinessOffset = (text: string): number =>
  readInteger(text, -MAX_BUSINESS_DAYS, MAX_BUSINESS_DAYS, `営業日数は ±${MAX_BUSINESS_DAYS} 以内の整数で入力してください`);
