/** 年月日（暦の日付）の計算と、日本時間の今日の日付。時刻とタイムゾーンの変換は timezone.ts にある。 */
import { civilFromDays, daysFromCivil } from './civilTime';
import { DAY_MS, JST_OFFSET_MS } from './timezone';

/**
 * タイムゾーンの影響を受けない「日付だけ」の値。
 * 通算日の整数として計算し、Date の範囲や JST/UTC のずれに依存しません。
 */
export type Ymd = { y: number; m: number; d: number };

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 整数の年月日がグレゴリオ暦で存在するかを確かめる。年の業務上の許容範囲は呼び出し側で制限する。 */
export function isValidYmd({ y, m, d }: Ymd): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

/** 月ごとの日数（2月はうるう年でない年）。呼ぶたびに配列を作らないよう、1つだけ持つ */
const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** グレゴリオ暦のうるう年かを返す。 */
const isLeapYear = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/**
 * 月の日数（m は 1〜12）。Date.UTC は 0〜99 年を 1900 年代として扱い、0年（うるう年）の2月を
 * 28日（1900年として）にしてしまうため、計算で求める
 */
export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  const days = DAYS_IN_MONTH[m - 1];
  if (days === undefined) throw new RangeError(`月は 1〜12 です（${m}）`);
  return days;
}

/** 通算日（1970-01-01 を 0 とする日数） */
export const toDayNumber = ({ y, m, d }: Ymd) => daysFromCivil(y, m, d);
/** 1970-01-01 を 0 とする通算日から年月日を求める。 */
const fromDayNumber = (n: number): Ymd => {
  const { y, mo, d } = civilFromDays(n);
  return { y, m: mo, d };
};

/** 日付に指定日数を加える。負の値なら前の日付を求める。 */
export const addDays = (v: Ymd, days: number) => fromDayNumber(toDayNumber(v) + days);

/** 曜日（0=日曜） */
export const dayOfWeek = (v: Ymd) => ((toDayNumber(v) + 4) % 7 + 7) % 7;

/** 日付の差を日数で返す。a が b より前なら負、同じなら 0。 */
export const compareYmd = (a: Ymd, b: Ymd) => toDayNumber(a) - toDayNumber(b);

/** 年を最低4桁、月日を2桁で表示する。値の妥当性は検証しない。 */
export const formatYmd = ({ y, m, d }: Ymd, sep = '-') =>
  `${String(y).padStart(4, '0')}${sep}${String(m).padStart(2, '0')}${sep}${String(d).padStart(2, '0')}`;

/** 全角数字と、日付の区切りに使う全角の記号（．／－）を半角にする。長音符（ー）もハイフンとして読む（区切りに使われることがあるため） */
export const toHalfWidthDigits = (s: string) =>
  s.replace(/[０-９．／－ー]/g, (c) => {
    if (c === 'ー') return '-';
    return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
  });

/**
 * 「2026-10-26」「2026/10/26」「20261026」「2026年10月26日」を読む。例外を投げない。
 *
 * @remarks
 * 一覧の項目を1つずつ読む処理（独自休日など）で使う。読めない項目ごとに例外を作ると、
 * 読めない項目が10万件あるとき、例外だけで画面が1秒以上止まるため。
 *
 * @returns 年月日。形式が違えば 'format'、存在しない日付なら 'invalid'。
 */
export function readYmd(input: string): Ymd | 'format' | 'invalid' {
  const s = toHalfWidthDigits(input.trim());
  const m =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s) ??
    /^(\d{4})(\d{2})(\d{2})$/.exec(s) ??
    /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (!m) return 'format';
  const v = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return isValidYmd(v) ? v : 'invalid';
}

/**
 * 「2026-10-26」「2026/10/26」「20261026」「2026年10月26日」を解釈する。
 *
 * @throws 形式が違う、または存在しない日付の場合（文言は画面にそのまま表示できる）。
 */
export function parseYmd(input: string): Ymd {
  const v = readYmd(input);
  if (v === 'format') throw new Error('「2026-10-26」「2026/10/26」「20261026」の形式で入力してください');
  if (v === 'invalid') throw new Error('存在しない日付です');
  return v;
}

/**
 * UNIX 時刻から日本時間の日付を求める。
 *
 * @param now - ミリ秒単位の UNIX 時刻。省略時は現在時刻。
 * @returns 日本時間の年月日。
 */
export function todayJst(now: number = Date.now()): Ymd {
  return fromDayNumber(Math.floor((now + JST_OFFSET_MS) / DAY_MS));
}

/**
 * 日本時間で次に日付が変わるまでのミリ秒（1ミリ秒から1日まで）。
 *
 * @remarks
 * useTodayJst が、日付の変わり目に今日の日付を更新するタイマーに使う。ちょうど日付が変わった時刻では1日を返す
 * （0 を返すと、同じ時刻でタイマーを何度も作り直すため）。1970年より前（負の時刻）でも正しい境目を返す。
 *
 * @param now - ミリ秒単位の UNIX 時刻。
 */
export function msUntilNextJstDay(now: number): number {
  const elapsed = (((now + JST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - elapsed;
}
