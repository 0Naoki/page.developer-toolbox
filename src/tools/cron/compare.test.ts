import { describe, expect, it } from 'vitest';
import { nextRuns } from './nextRuns';
import { parseCron, type Dialect } from './parse';

/**
 * Quartz・EventBridge の式を乱数で作り、nextRuns の結果を、別に書いた素朴な実装（1日ずつ調べる）と比べる。
 * 素朴な実装は nextRuns.ts・parse.ts の部品（日付の判定・候補の列挙）を使わず、Quartz のドキュメントの説明どおりに書く。
 * - 曜日は 1（日）〜 7（土）。曜日の L だけは 7 と同じ、nL は最終 n 曜日、n#k は第 k n 曜日
 * - 日の L は月末、L-n は月末の n 日前、LW は月末に最も近い平日、nW は n 日に最も近い平日（月をまたがない。n 日がない月は実行しない）
 * - ? は指定なし。日と曜日のどちらか一方だけに書く
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 「*」「5」「1-10/3」「*\/15」「5/20」「JAN-MAR」などのカンマ区切りを、値の集合にする */
function values(field: string, min: number, max: number, names: string[] = [], nameBase = 0): Set<number> {
  const out = new Set<number>();
  const num = (s: string) => (names.includes(s) ? names.indexOf(s) + nameBase : Number(s));
  for (const part of field.split(',')) {
    const [body = '', stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    let [lo, hi] = [min, max];
    if (body !== '*') {
      const [a = '', b] = body.split('-');
      lo = num(a);
      hi = b !== undefined ? num(b) : stepText !== undefined ? max : lo;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** n 日（その月にある日）に最も近い平日。土曜なら前の金曜（1日なら次の月曜）、日曜なら次の月曜（月末なら前の金曜） */
function nearestWeekday(y: number, m: number, n: number): number {
  const w = weekday(y, m, n);
  if (w === 6) return n === 1 ? 3 : n - 1;
  if (w === 0) return n === daysIn(y, m) ? n - 2 : n + 1;
  return n;
}

function dayMatches(field: string, y: number, m: number, d: number): boolean {
  const last = daysIn(y, m);
  if (field === '?') return true;
  if (field === 'L') return d === last;
  if (field === 'LW') return d === nearestWeekday(y, m, last);
  if (field.startsWith('L-')) return d === last - Number(field.slice(2));
  if (field.endsWith('W')) {
    const n = Number(field.slice(0, -1));
    return n <= last && d === nearestWeekday(y, m, n);
  }
  return values(field, 1, 31).has(d);
}

function weekdayMatches(field: string, y: number, m: number, d: number): boolean {
  const w = weekday(y, m, d) + 1; /** 1（日）〜 7（土） */
  const num = (s: string) => (WEEKDAYS.includes(s) ? WEEKDAYS.indexOf(s) + 1 : Number(s));
  if (field === '?') return true;
  if (field === 'L') return w === 7;
  if (field.endsWith('L')) return w === num(field.slice(0, -1)) && d + 7 > daysIn(y, m);
  if (field.includes('#')) {
    const [dow = '', k] = field.split('#');
    return w === num(dow) && Math.ceil(d / 7) === Number(k);
  }
  return values(field, 1, 7, WEEKDAYS, 1).has(w);
}

type Fields = { second: string; minute: string; hour: string; day: string; month: string; weekday: string; year: string };

/** 壁時計が UTC から offsetMinutes ずれたタイムゾーン（夏時間なし）で、from より後の実行日時を、until より前まで最大 count 件 */
function reference(f: Fields, offsetMinutes: number, from: number, count: number, until: number): number[] {
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  const seconds = sorted(values(f.second, 0, 59));
  const minutes = sorted(values(f.minute, 0, 59));
  const hours = sorted(values(f.hour, 0, 23));
  const months = values(f.month, 1, 12, MONTHS, 1);
  const years = values(f.year, 1970, 2099);
  const offset = offsetMinutes * 60_000;
  const runs: number[] = [];
  const start = new Date(from + offset);
  for (let day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()); day + 86_400_000 - offset <= until + 86_400_000; day += 86_400_000) {
    const date = new Date(day);
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    if (!years.has(y) || !months.has(m) || !dayMatches(f.day, y, m, d) || !weekdayMatches(f.weekday, y, m, d)) continue;
    for (const h of hours) for (const mi of minutes) for (const s of seconds) {
      const time = day + ((h * 60 + mi) * 60 + s) * 1000 - offset;
      if (time <= from || time >= until) continue;
      runs.push(time);
      if (runs.length === count) return runs;
    }
  }
  return runs;
}

let seed = 20261108;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

const DAYS = ['*', '1', '15', '31', '29', 'L', 'L-2', 'LW', '15W', '1W', '31W', '1-10/3', '10/7', '5,20'];
const WEEKDAY_TOKENS = ['*', '2', 'MON-FRI', '1,7', 'SAT', '7', 'L', '6L', 'SUNL', '2#1', '5#5', 'FRI#3', '2-6/2'];

function randomFields(): Fields {
  const dayFirst = random() < 0.5;
  return {
    second: pick(['0', '30', '*/20', '5,45', '10-20/5', '15/30']),
    minute: pick(['0', '*/15', '5,35', '59', '0-10/5', '*', '7/25']),
    hour: pick(['0', '9', '*/6', '9-17', '23', '*', '1,13']),
    day: dayFirst ? pick(DAYS) : '?',
    month: pick(['*', '2', '*/3', 'JAN-MAR', '12', '2,8', '4/5']),
    weekday: dayFirst ? '?' : pick(WEEKDAY_TOKENS),
    year: pick(['*', '*', '2026-2030', '2027', '2026/2', '2031']),
  };
}

const ZONES = [{ zone: 'UTC', offset: 0 }, { zone: 'Asia/Tokyo', offset: 540 }];
const YEARS = 12;

function compare(dialect: Dialect, cases: number) {
  for (let i = 0; i < cases; i++) {
    const f = randomFields();
    if (dialect === 'aws') f.second = '0';
    const expression = dialect === 'aws'
      ? [f.minute, f.hour, f.day, f.month, f.weekday, f.year].join(' ')
      : [f.second, f.minute, f.hour, f.day, f.month, f.weekday, ...(f.year === '*' && random() < 0.5 ? [] : [f.year])].join(' ');
    const { zone, offset } = pick(ZONES);
    const from = Date.UTC(2026, Math.floor(random() * 12), 1 + Math.floor(random() * 28), Math.floor(random() * 24), Math.floor(random() * 60), Math.floor(random() * 60), Math.floor(random() * 1000));
    const until = Date.UTC(2026 + YEARS, 0, 1);
    const expected = reference(f, offset, from, 5, until);
    /** 素朴な実装は YEARS 年先までしか探さないため、それより後の結果は比べない */
    const actual = nextRuns(parseCron(expression, dialect), zone, from, 5).filter((t) => t < until);
    const show = (list: number[]) => list.map((t) => new Date(t).toISOString());
    expect(show(actual), `${dialect}「${expression}」${zone} ${new Date(from).toISOString()} から`).toEqual(show(expected));
  }
}

describe('nextRuns：Quartz・EventBridge を素朴な実装と比べる', () => {
  it('Quartz（秒・年の省略を含む）', () => compare('quartz', 400), 60_000);
  it('EventBridge', () => compare('aws', 400), 60_000);
});
