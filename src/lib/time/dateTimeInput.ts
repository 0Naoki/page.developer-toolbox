/** 日時の入力の解析。表示した日時（dateTimeFormat.ts）を入力に貼り戻すと、同じ時刻に読む。 */
import { dayOfWeek, daysInMonth, WEEKDAYS_JA } from './date';
import { checked, isValidZone, utcOf, zonedToUtc, type Wall, type Zone } from './timezone';

/**
 * 表示に添えた曜日（「（月）」「(月)」）。cron の次回の実行日時などの表示を、そのまま貼り戻せるようにする。
 * 前後の空白は正規表現に含めない（先頭の \s* があると、長い空白の入力で検索が入力長の2乗の時間になるブラウザがある）
 */
const WEEKDAY_NOTE = /[（(]([日月火水木金土])[)）]/;

/**
 * 日時文字列を解釈する。秒付きのオフセット（+09:18:59）も読める。指定がなければ zone の時刻として解釈する。
 * 曜日（「（月）」）が添えてあれば、書かれた日付の曜日と一致するかを確かめる（合わなければ、日付か曜日の書き誤り）。
 */
export function parseDateTime(input: string, zone: Zone): Date {
  const weekdayNote = WEEKDAY_NOTE.exec(input);
  const weekday = weekdayNote?.[1];
  const s = (weekdayNote ? `${input.slice(0, weekdayNote.index).trimEnd()} ${input.slice(weekdayNote.index + weekdayNote[0].length).trimStart()}` : input)
    .trim()
    .replace(/\//g, '-');
  const m = /^(\d{4}|[+-]\d{6})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|UTC|GMT|JST|[+-]\d{2}(?::\d{2}(?::\d{2})?|\d{2})?)?$/i.exec(s);
  /** 時刻のない「2026-1-5-09」の -09 は、オフセットとは読まない */
  if (!m || (!m[4] && /^[+-]\d{2}$/.test(m[8] ?? ''))) throw new Error('「2026-10-02 15:30:00」「2026-10-02 15:30:00 +09:00」やISO8601形式で入力してください');
  const [, y, mo, d, h = '0', mi = '0', sec = '0', frac = '', tz] = m;
  /** ISO8601 の拡張年に負のゼロはない */
  if (y === '-000000') throw new Error('年の -000000 は使えません。西暦0年は 0000 と書いてください');
  /** new Date は「2026-02-29」を3月1日に、「24:00」を翌日に繰り上げるため、先に範囲を確かめる */
  const month = Number(mo);
  if (month < 1 || month > 12 || Number(d) < 1 || Number(d) > daysInMonth(Number(y), month)) {
    throw new Error('存在しない日付です');
  }
  if (Number(h) > 23 || Number(mi) > 59 || Number(sec) > 59) throw new Error('存在しない時刻です');
  if (weekday !== undefined && WEEKDAYS_JA[dayOfWeek({ y: Number(y), m: month, d: Number(d) })] !== weekday) {
    throw new Error(`曜日（${weekday}）が日付と合いません`);
  }
  const wall: Wall = { y: Number(y), mo: month, d: Number(d), h: Number(h), mi: Number(mi), s: Number(sec), ms: Number(frac.slice(1, 4).padEnd(3, '0')) };
  if (tz) {
    if (/^[a-z]/i.test(tz)) return checked(utcOf(wall) - (tz.toUpperCase() === 'JST' ? 540 : 0) * 60000);
    const hours = Number(tz.slice(1, 3));
    const minutes = Number(tz.slice(3).replace(':', '').slice(0, 2));
    const seconds = tz.length === 9 ? Number(tz.slice(7)) : 0;
    if (hours > 23 || minutes > 59) throw new Error('タイムゾーンのオフセットは時が0〜23、分が0〜59で指定してください');
    if (seconds > 59) throw new Error('タイムゾーンのオフセットの秒は0〜59で指定してください');
    const offset = (tz[0] === '-' ? -1 : 1) * (hours * 3600 + minutes * 60 + seconds);
    return checked(utcOf(wall) - offset * 1000);
  }
  if (!isValidZone(zone)) throw new Error(`タイムゾーン「${zone}」が見つかりません`);
  return checked(zonedToUtc(wall, zone));
}
