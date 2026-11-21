import { addDays, compareYmd, dayOfWeek, daysInMonth, formatYmd, readYmd, toDayNumber, type Ymd } from '../../lib/time/date';
import { HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR, holidayName } from './holidays';
import { textPreview } from '../../lib/text/textPreview';
import { splitLines } from '../../lib/text/lines';
import { formatNumber } from '../../lib/number';

export type Calendar = {
  /** 休みにする曜日（0=日〜6=土） */
  weekend: number[];
  /** 祝日を休みにする */
  holidays: boolean;
  /** 年末年始（12/29〜1/3）を休みにする */
  yearEnd: boolean;
  /** 会社独自の休日（YYYY-MM-DD） */
  extra: string[];
};

export const DEFAULT_CALENDAR: Calendar = { weekend: [0, 6], holidays: true, yearEnd: false, extra: [] };

export type DayInfo = { business: boolean; reason: string | null };

function checkRange(date: Ymd, cal: Calendar) {
  if (cal.holidays && (date.y < HOLIDAY_MIN_YEAR || date.y > HOLIDAY_MAX_YEAR)) {
    throw new Error(`祝日は${HOLIDAY_MIN_YEAR}〜${HOLIDAY_MAX_YEAR}年の範囲で計算できます`);
  }
}

/** 日ごとに独自休日の配列を探すと「日数 × 件数」の計算量になるため、配列ごとに Set を作って使い回す（配列は変更しない前提） */
const extraSets = new WeakMap<readonly string[], ReadonlySet<string>>();

function extraSet(extra: readonly string[]): ReadonlySet<string> {
  let set = extraSets.get(extra);
  if (!set) {
    set = new Set(extra);
    extraSets.set(extra, set);
  }
  return set;
}

/** 画面に示す読めない項目の件数 */
export const MAX_INVALID_SHOWN = 20;
/** 読めない項目1件の表示の長さ（UTF-16単位）。入力欄はプレビューに制限しているため、診断で長い1行を全文描画しない */
export const MAX_INVALID_PREVIEW = 100;

/** 読めない項目の診断。text は表示用の抜粋、length は元の長さ（UTF-16 の単位。抜粋したかの判定に使う）、chars は元の文字数（コードポイント数。文言に出す） */
export type InvalidHoliday = { line: number; text: string; length: number; chars: number };

/** 文字数（コードポイント数）。配列を作らずに数える */
function codePointCount(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

/**
 * 会社独自の休日の入力を読む。1行に1日付で、カンマで区切ってもよい。
 *
 * @remarks
 * 「2026/10/26」「20261026」「2026年10月26日」などは「2026-10-26」の形にそろえる。空行と前後の空白は無視する。
 * 読めない項目は捨てずに知らせる。診断は先頭の {@link MAX_INVALID_SHOWN} 件に限り、各項目は行番号・
 * {@link MAX_INVALID_PREVIEW} 単位までの抜粋・元の長さにする。総件数は invalidCount。
 */
export function parseExtraHolidays(text: string): { dates: string[]; invalid: InvalidHoliday[]; invalidCount: number } {
  const dates: string[] = [];
  const invalid: InvalidHoliday[] = [];
  let invalidCount = 0;
  const lines = splitLines(text);
  for (const [i, line] of lines.entries()) {
    for (const raw of line.split(',')) {
      const s = raw.trim();
      if (!s) continue;
      /** 読めない項目が大量にあっても止まらないよう、例外を投げない readYmd で読む */
      const date = readYmd(s);
      if (typeof date !== 'string') {
        dates.push(formatYmd(date));
        continue;
      }
      invalidCount++;
      if (invalid.length < MAX_INVALID_SHOWN) {
        invalid.push({ line: i + 1, text: s.length > MAX_INVALID_PREVIEW ? textPreview(s, MAX_INVALID_PREVIEW) : s, length: s.length, chars: codePointCount(s) });
      }
    }
  }
  return { dates, invalid, invalidCount };
}

/**
 * 読めない独自休日の文言。総件数を先頭に置き、続けて先頭の項目の行番号と抜粋を並べる。
 *
 * @remarks
 * 表示（1,000単位）と読み上げ（256単位）は文言を後ろで切るため、総件数を末尾に置くと、項目が長い・多いときに件数が消える。
 */
export function invalidHolidaysMessage({ invalid, invalidCount }: { invalid: InvalidHoliday[]; invalidCount: number }): string {
  const items = invalid.map((item) => `${item.line}行目「${item.text}${item.text.length < item.length ? `…（全${formatNumber(item.chars)}文字）` : ''}」`);
  const head = invalidCount > invalid.length ? `（先頭 ${formatNumber(invalid.length)} 件）` : '';
  return `読み取れない日付が ${formatNumber(invalidCount)} 件あります${head}：${items.join('、')}`;
}

export function dayInfo(date: Ymd, cal: Calendar): DayInfo {
  checkRange(date, cal);
  if (extraSet(cal.extra).has(formatYmd(date))) return { business: false, reason: '独自休日' };
  if (cal.holidays) {
    const name = holidayName(date);
    if (name) return { business: false, reason: name };
  }
  if (cal.yearEnd && ((date.m === 12 && date.d >= 29) || (date.m === 1 && date.d <= 3))) {
    return { business: false, reason: '年末年始' };
  }
  if (cal.weekend.includes(dayOfWeek(date))) return { business: false, reason: '週末' };
  return { business: true, reason: null };
}

const isBusinessDay = (date: Ymd, cal: Calendar) => dayInfo(date, cal).business;

/**
 * 期間の上限（年）。判定は日数で行い、366日 × 30 = 10,980日まで（暦の30年より約3週間長い。うるう年の位置によらず、30年の期間を必ず受け付けるため）
 */
export const MAX_SPAN_YEARS = 30;
/** n営業日後・前の上限 */
export const MAX_BUSINESS_DAYS = 3000;
/** 前後移動で扱う年の下限。日付入力と同じ4桁の範囲に収める。 */
export const MIN_BUSINESS_YEAR = 0;
/** 前後移動で扱う年の上限。 */
export const MAX_BUSINESS_YEAR = 9999;
const MAX_SPAN = 366 * MAX_SPAN_YEARS;

/** 日付入力へ戻せない年に探索が進んだ場合は、結果を返さずに止める。 */
function checkedBusinessDate(date: Ymd): Ymd {
  if (!Number.isInteger(date.y) || date.y < MIN_BUSINESS_YEAR || date.y > MAX_BUSINESS_YEAR) {
    throw new Error(`営業日の前後移動は${String(MIN_BUSINESS_YEAR).padStart(4, '0')}〜${MAX_BUSINESS_YEAR}年の範囲で計算してください`);
  }
  return date;
}

/** 期間を日付順に1回だけ調べる。内訳が必要な場合だけ、日ごとの判定を呼び出し側に渡す。 */
function scanBusinessRange(from: Ymd, to: Ymd, cal: Calendar, visit?: (date: Ymd, info: DayInfo) => void): { business: number; calendar: number } {
  const [start, end] = compareYmd(from, to) <= 0 ? [from, to] : [to, from];
  const span = toDayNumber(end) - toDayNumber(start) + 1;
  if (span > MAX_SPAN) throw new Error(`期間は${MAX_SPAN_YEARS}年以内で指定してください`);
  let business = 0;
  for (let i = 0; i < span; i++) {
    const date = addDays(start, i);
    const info = dayInfo(date, cal);
    if (info.business) business++;
    visit?.(date, info);
  }
  return { business, calendar: span };
}

/** 期間内（両端を含む）の営業日数。休日一覧の配列は作らない。 */
export function countBusinessDays(from: Ymd, to: Ymd, cal: Calendar): { business: number; calendar: number } {
  return scanBusinessRange(from, to, cal);
}

/** 期間内の営業日数・暦日数と、週末だけの休みを除いた休日一覧を、1回の走査で集計する。逆順の入力も日付順に返す。 */
export function summarizeBusinessRange(from: Ymd, to: Ymd, cal: Calendar): { business: number; calendar: number; offDays: { date: Ymd; reason: string }[] } {
  const offDays: { date: Ymd; reason: string }[] = [];
  const counts = scanBusinessRange(from, to, cal, (date, info) => {
    if (!info.business && info.reason !== null && info.reason !== '週末') offDays.push({ date, reason: info.reason });
  });
  return { ...counts, offDays };
}

/**
 * n営業日後（n が負なら前）の日付。基準日自体は数えない。
 * n = 0 のときは、基準日が休みならその次の営業日を返す。
 */
export function addBusinessDays(date: Ymd, n: number, cal: Calendar): Ymd {
  if (!Number.isInteger(n) || Math.abs(n) > MAX_BUSINESS_DAYS) throw new Error(`営業日数は ±${MAX_BUSINESS_DAYS} 以内の整数で指定してください`);
  const notFound = () => new Error('営業日が見つかりません。休日の設定を確認してください');
  if (new Set(cal.weekend).size === 7) throw notFound();
  /** 週に1日でも営業日があれば n × 7 日で足りる。独自休日や祝日が重なる分の余裕を足して、探索回数に上限を設ける */
  const limit = MAX_SPAN + Math.abs(n) * 7;
  let current = checkedBusinessDate(date);
  let guard = 0;
  if (n === 0) {
    while (!isBusinessDay(current, cal)) {
      current = checkedBusinessDate(addDays(current, 1));
      if (++guard > limit) throw notFound();
    }
    return current;
  }
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    current = checkedBusinessDate(addDays(current, step));
    if (isBusinessDay(current, cal)) remaining--;
    if (++guard > limit) throw notFound();
  }
  return current;
}

/** その月の第n営業日（「第5営業日に支払い」など） */
export function nthBusinessDayOfMonth(y: number, m: number, n: number, cal: Calendar): Ymd | null {
  let count = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const date = { y, m, d };
    if (isBusinessDay(date, cal) && ++count === n) return date;
  }
  return null;
}

/** その月の最終営業日（月末締めの支払日など） */
export function lastBusinessDayOfMonth(y: number, m: number, cal: Calendar): Ymd | null {
  for (let d = daysInMonth(y, m); d >= 1; d--) {
    const date = { y, m, d };
    if (isBusinessDay(date, cal)) return date;
  }
  return null;
}

export type MonthSummary = { month: number; business: number; first: Ymd | null; last: Ymd | null };

/** 年間の月別営業日数 */
export function yearSummary(y: number, cal: Calendar): MonthSummary[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return {
      month: m,
      business: countBusinessDays({ y, m, d: 1 }, { y, m, d: daysInMonth(y, m) }, cal).business,
      first: nthBusinessDayOfMonth(y, m, 1, cal),
      last: lastBusinessDayOfMonth(y, m, cal),
    };
  });
}
