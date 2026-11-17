import { type Zone } from '../../lib/time/timezone';
import { parseDateTime } from '../../lib/time/dateTimeInput';
import { formatWithOffset, showsMillis } from '../../lib/time/dateTimeFormat';

/** エポック時間 */

export type EpochUnit = 's' | 'ms' | 'us' | 'ns';

/** 整数部の桁数に対応する単位。先頭の0を数えるかは呼び出し側が決める。 */
function unitOf(digits: number): EpochUnit {
  return digits >= 19 ? 'ns' : digits >= 16 ? 'us' : digits >= 13 ? 'ms' : 's';
}

/**
 * 桁数だけでは単位を決めきれないときの、もう1つの読み方（1つ細かい単位）。
 *
 * @remarks
 * 自動の判定は、今の時刻に近い値の桁数（秒10桁・ミリ秒13桁・マイクロ秒16桁・ナノ秒19桁）を基準にする。
 * その間の桁数（11〜12桁など）は、遠い将来の粗い単位とも、過去の細かい単位とも読める。
 * たとえば 1973〜2001年のミリ秒は12桁で、秒として読むと西暦2万年台になる。
 */
function alternativeUnitOf(digits: number): EpochUnit | undefined {
  if (digits === 11 || digits === 12) return 'ms';
  if (digits === 14 || digits === 15) return 'us';
  if (digits === 17 || digits === 18) return 'ns';
  return undefined;
}

/**
 * 数値文字列をエポック時間として解釈する。
 * マイクロ秒（Python の time_ns() // 1000、PostgreSQL など）やナノ秒（Go の UnixNano など）を
 * ミリ秒として読むと西暦5万年のような日時になるため、桁数で単位を判定する。
 *
 * 16桁以上の整数は Number にすると丸められ（1700000000123999999 → …124000000）、ミリ秒の値や
 * 単位の判定（999999999999999999 → 1e18）が変わるため、単位は文字列から判定し、
 * 秒は文字列から整数のミリ秒を組み立て、マイクロ秒・ナノ秒は末尾の桁を除いてミリ秒にする。
 * 範囲を文字列の桁数と辞書順で確認してから Number にし、巨大な範囲外値から BigInt を作らない。
 * ミリ秒未満は、Date と同じく 0 の方向へ切り捨てる
 *
 * @returns 日時と、読んだ単位。自動の判定で、桁数だけでは単位を決めきれないときは、もう1つの読み方（alternative）も返す
 */
export function parseEpoch(input: string, selectedUnit: EpochUnit | 'auto' = 'auto'): { date: Date; unit: EpochUnit; alternative?: EpochUnit } {
  const s = input.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error('数値を入力してください');
  const [, sign, int = '', frac = ''] = m;
  const digits = int.replace(/^0+/, '') || '0';
  const unit = selectedUnit === 'auto' ? unitOf(digits.length) : selectedUnit;
  /**
   * 小数を Number にしてから掛けると 1.001 * 1000 が 1000.999… になるため、整数として組み立てる。
   * Date の有効範囲内の整数ミリ秒は、Number でも正確に表せる。
   */
  const millis = (
    unit === 's'
      ? digits + frac.slice(0, 3).padEnd(3, '0')
      : unit === 'ms'
        ? digits
        : digits.slice(0, unit === 'us' ? -3 : -6)
  ).replace(/^0+/, '') || '0';
  const maxMillis = '8640000000000000';
  if (millis.length > maxMillis.length || (millis.length === maxMillis.length && millis > maxMillis)) {
    throw new Error('日時に変換できない値です');
  }
  const date = new Date(Number(sign + millis));
  const alternative = selectedUnit === 'auto' ? alternativeUnitOf(digits.length) : undefined;
  return alternative ? { date, unit, alternative } : { date, unit };
}

/** エポック時間の入力が、ミリ秒以上の精度で書かれているか（ミリ秒以下の単位、または秒の小数部） */
export const isSubSecondEpoch = (input: string, unit: EpochUnit): boolean => unit !== 's' || input.includes('.');

/** 「now」「現在」、エポック時間（数値）、日時のどれでも読む */
export function parseAny(input: string, zone: Zone, now: number): Date {
  const s = input.trim();
  if (/^(now|現在|今)$/i.test(s)) return new Date(now);
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseEpoch(s).date;
  return parseDateTime(s, zone);
}

/** 一括変換 */

/** 10桁（秒）・13桁（ミリ秒）・16桁（マイクロ秒）・19桁（ナノ秒）の数値（負数も含む）。前後が英数字なら ID などとみなして対象外 */
/**
 * 数字の直前の - も境界から除き、負数の数字部分だけに一致するのを防ぐ。
 * 「1700000000.123abc」の小数部分が一致しないときに整数部分だけへ後退しないよう、後ろに英数字も「.数字」も
 * 続かないことを確かめる（文の終わりの「.」は数値の一部ではないので許す）。「3.1700000000」の小数部分も対象外
 */
const EPOCH_IN_TEXT = /(?<![\w-]|\d\.)-?(\d{10}(?:\d{3}|\d{6}|\d{9})?)(\.\d+)?(?!\w|\.\d)/g;

export type BulkMode = 'append' | 'replace';

/** テキスト中のエポック時間を、日時に置き換える（または後ろに付け足す） */
export function convertEpochsInText(text: string, zone: Zone, mode: BulkMode): { output: string; count: number } {
  let count = 0;
  const output = text.replace(EPOCH_IN_TEXT, (match, integer: string) => {
    try {
      const unit = unitOf(integer.length);
      const { date } = parseEpoch(match, unit);
      const shown = formatWithOffset(date, zone, showsMillis(date, isSubSecondEpoch(match, unit)));
      count++;
      return mode === 'replace' ? shown : `${match} [${shown}]`;
    } catch {
      return match;
    }
  });
  return { output, count };
}
