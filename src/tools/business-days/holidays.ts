import { addDays, dayOfWeek, formatYmd, type Ymd } from '../../lib/time/date';

/**
 * 日本の祝日を「国民の祝日に関する法律」の規則から計算する。
 *
 * - 春分・秋分の日は天文計算による近似式（1980〜2099年で有効）。
 *   正式には前年2月の官報で公表されるため、遠い将来の年は変わる可能性がある。
 * - 将来の法改正や特例（オリンピックのような移動）は反映されない。
 */
export const HOLIDAY_MIN_YEAR = 1980;
export const HOLIDAY_MAX_YEAR = 2099;

export type Holiday = { date: Ymd; name: string };

const key = (y: number, m: number, d: number) => formatYmd({ y, m, d });

/** m月の第n月曜日 */
function nthMonday(y: number, m: number, n: number): number {
  const first = dayOfWeek({ y, m, d: 1 });
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

function vernalEquinoxDay(y: number): number {
  return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

function autumnalEquinoxDay(y: number): number {
  return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

/** 法律で日付が決まっている祝日（振替休日・国民の休日を除く） */
function baseHolidays(y: number): Map<string, string> {
  const h = new Map<string, string>();
  const add = (m: number, d: number, name: string) => h.set(key(y, m, d), name);

  add(1, 1, '元日');
  if (y >= 2000) add(1, nthMonday(y, 1, 2), '成人の日');
  else add(1, 15, '成人の日');
  add(2, 11, '建国記念の日');
  if (y >= 2020) add(2, 23, '天皇誕生日');
  add(3, vernalEquinoxDay(y), '春分の日');
  if (y >= 2007) add(4, 29, '昭和の日');
  else if (y >= 1989) add(4, 29, 'みどりの日');
  else add(4, 29, '天皇誕生日');
  add(5, 3, '憲法記念日');
  if (y >= 2007) add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');

  if (y === 2020) add(7, 23, '海の日');
  else if (y === 2021) add(7, 22, '海の日');
  else if (y >= 2003) add(7, nthMonday(y, 7, 3), '海の日');
  else if (y >= 1996) add(7, 20, '海の日');

  if (y === 2020) add(8, 10, '山の日');
  else if (y === 2021) add(8, 8, '山の日');
  else if (y >= 2016) add(8, 11, '山の日');

  if (y >= 2003) add(9, nthMonday(y, 9, 3), '敬老の日');
  else add(9, 15, '敬老の日');
  add(9, autumnalEquinoxDay(y), '秋分の日');

  if (y === 2020) add(7, 24, 'スポーツの日');
  else if (y === 2021) add(7, 23, 'スポーツの日');
  else if (y >= 2022) add(10, nthMonday(y, 10, 2), 'スポーツの日');
  else if (y >= 2000) add(10, nthMonday(y, 10, 2), '体育の日');
  else add(10, 10, '体育の日');

  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');
  if (y >= 1989 && y <= 2018) add(12, 23, '天皇誕生日');

  /** 特別法による祝日 */
  if (y === 1989) add(2, 24, '昭和天皇の大喪の礼');
  if (y === 1990) add(11, 12, '即位礼正殿の儀');
  if (y === 1993) add(6, 9, '結婚の儀');
  if (y === 2019) {
    add(5, 1, '天皇の即位の日');
    add(10, 22, '即位礼正殿の儀');
  }
  return h;
}

const cache = new Map<number, Holiday[]>();

/** その年の祝日・休日（振替休日、国民の休日を含む）を日付順に返す */
export function holidaysOfYear(y: number): Holiday[] {
  if (y < HOLIDAY_MIN_YEAR || y > HOLIDAY_MAX_YEAR) {
    throw new Error(`祝日は${HOLIDAY_MIN_YEAR}〜${HOLIDAY_MAX_YEAR}年に対応しています`);
  }
  const cached = cache.get(y);
  if (cached) return cached;

  const base = baseHolidays(y);
  /** 年をまたぐ振替（12/31 は祝日でないので実際には発生しない）は考慮しない */
  const all = new Map(base);

  /** 振替休日：祝日が日曜日なら、その後の最も近い「祝日でない日」（2006年までは翌日のみ） */
  for (const k of base.keys()) {
    const date = parseKey(k);
    if (dayOfWeek(date) !== 0) continue;
    let next = addDays(date, 1);
    if (y >= 2007) {
      while (base.has(formatYmd(next))) next = addDays(next, 1);
    } else if (base.has(formatYmd(next))) {
      continue;
    }
    if (next.y === y) all.set(formatYmd(next), '休日（振替休日）');
  }

  /**
   * 国民の休日：前日と翌日が祝日で、それ自体は祝日・休日・日曜日でない日。
   * 1985年12月27日施行の改正で生まれた規定なので、1986年以降にだけ適用する
   */
  for (const k of y >= 1986 ? base.keys() : []) {
    const middle = addDays(parseKey(k), 1);
    const mk = formatYmd(middle);
    if (all.has(mk) || dayOfWeek(middle) === 0) continue;
    if (base.has(formatYmd(addDays(middle, 1)))) all.set(mk, '休日（国民の休日）');
  }

  const list = [...all]
    .map(([k, name]) => ({ date: parseKey(k), name }))
    .sort((a, b) => formatYmd(a.date).localeCompare(formatYmd(b.date)));
  cache.set(y, list);
  return list;
}

function parseKey(k: string): Ymd {
  /** キーは baseHolidays などが作る「年-月-日」なので、3つとも必ずある（既定値は型のためだけ） */
  const [y = NaN, m = NaN, d = NaN] = k.split('-').map(Number);
  return { y, m, d };
}

/** 祝日なら名前、そうでなければ null */
export function holidayName(date: Ymd): string | null {
  if (date.y < HOLIDAY_MIN_YEAR || date.y > HOLIDAY_MAX_YEAR) return null;
  const k = formatYmd(date);
  return holidaysOfYear(date.y).find((h) => formatYmd(h.date) === k)?.name ?? null;
}
