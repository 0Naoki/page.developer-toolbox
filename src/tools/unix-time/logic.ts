import { daysInMonth } from '../../lib/time/date';
import { DateRangeError, checked, wallOf, addZonedElapsed, type Wall, type Zone } from '../../lib/time/timezone';
import { formatJst, relativeFrom } from '../../lib/time/dateTimeFormat';
import { civilFromDays, daysFromCivil } from '../../lib/time/civilTime';
import { formatNumber } from '../../lib/number';

export type TimeView = {
  epochSeconds: number;
  epochMillis: number;
  iso: string;
  jst: string;
  relative: string;
};

export function toView(date: Date, now: number = Date.now()): TimeView {
  const ms = date.getTime();
  return {
    epochSeconds: Math.floor(ms / 1000),
    epochMillis: ms,
    iso: date.toISOString(),
    jst: formatJst(date),
    relative: relativeFrom(date, now),
  };
}

export type Difference = {
  /** b − a（ミリ秒） */
  ms: number;
  /** 「2日 3時間 4分 5秒」の形（負なら先頭に「−」） */
  text: string;
  totalDays: number;
  totalHours: number;
  totalMinutes: number;
  totalSeconds: number;
};

/** 2つの日時の差（b − a） */
export function difference(a: Date, b: Date): Difference {
  /**
   * Date の範囲の両端どうしの差（約1.7×10¹⁶）は安全な整数を超え、Number で引くとミリ秒が丸められる。
   * 内訳は整数で正確に計算する（合計の日数などは小数の目安なので Number のまま）
   */
  const exact = BigInt(b.getTime()) - BigInt(a.getTime());
  const ms = Number(exact);
  let rest = exact < 0n ? -exact : exact;
  const parts: string[] = [];
  for (const [unit, size] of [['日', 86400000n], ['時間', 3600000n], ['分', 60000n], ['秒', 1000n], ['ミリ秒', 1n]] as const) {
    const n = rest / size;
    rest %= size;
    if (n > 0n) parts.push(`${n}${unit}`);
  }
  return {
    ms,
    text: parts.length === 0 ? '0秒' : (exact < 0n ? '−' : '') + parts.join(' '),
    totalDays: ms / 86400000,
    totalHours: ms / 3600000,
    totalMinutes: ms / 60000,
    totalSeconds: ms / 1000,
  };
}

/** 期間。年・月・日は暦（壁時計）で、ms は経過時間で足す */
export type Duration = { years: number; months: number; days: number; ms: number };

/** 期間の入力上限（UTF-16単位）。画面側で巨大な整数の解析を続けないために制限する。 */
export const MAX_DURATION_INPUT = 1_000;

const UNIT_PATTERN = /([+-]?)\s*(\d+)\s*(ミリ秒|ms|ヶ月|か月|ヵ月|カ月|mo|年|y|週間|週|w|日|d|時間|h|分|m|秒|s)/giy;

const UNIT_SIZE: Record<string, [keyof Duration, number]> = {
  年: ['years', 1], y: ['years', 1],
  ヶ月: ['months', 1], か月: ['months', 1], ヵ月: ['months', 1], カ月: ['months', 1], mo: ['months', 1],
  週間: ['days', 7], 週: ['days', 7], w: ['days', 7],
  日: ['days', 1], d: ['days', 1],
  時間: ['ms', 3600000], h: ['ms', 3600000],
  分: ['ms', 60000], m: ['ms', 60000],
  秒: ['ms', 1000], s: ['ms', 1000],
  ミリ秒: ['ms', 1], ms: ['ms', 1],
};

/** 合算した期間を、丸めずに数値として扱える場合だけ返す。 */
function durationNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('期間の値が大きすぎます。合算後の各単位を安全な整数の範囲内で指定してください。');
  return number;
}

/**
 * 「+1d 2h」「-90m」「1年2ヶ月」のような期間を読む。
 * 符号は、次に符号が出てくるまでの単位に掛かる（「-1d 2h」は1日と2時間を引く）。
 * 単位ごとに整数として合算してから、安全な整数の範囲を確かめて数値に戻す。
 */
export function parseDuration(input: string): Duration {
  if (input.length > MAX_DURATION_INPUT) throw new Error(`期間は${formatNumber(MAX_DURATION_INPUT)}単位までで入力してください。`);
  const s = input.trim();
  if (!s) throw new Error('期間を入力してください');
  const d = { years: 0n, months: 0n, days: 0n, ms: 0n };
  let sign = 1n;
  let pos = 0;
  UNIT_PATTERN.lastIndex = 0;
  while (pos < s.length) {
    UNIT_PATTERN.lastIndex = pos;
    const m = UNIT_PATTERN.exec(s);
    if (!m) throw new Error('「+1d 2h 30m」「-90分」「1年2ヶ月」の形で入力してください（単位：年 y・ヶ月 mo・週 w・日 d・時間 h・分 m・秒 s・ミリ秒 ms）');
    const [, signText, amount = '0', unitText = ''] = m;
    if (signText) sign = signText === '-' ? -1n : 1n;
    /** 表のキーは小文字（日本語の単位は大文字小文字がない）なので、小文字にして引く */
    const unit = UNIT_SIZE[unitText.toLowerCase()];
    /** 単位は UNIT_PATTERN で、表にあるものだけに一致する（ここは型の絞り込みのため） */
    if (!unit) throw new Error(`単位「${unitText}」は使えません`);
    const [key, size] = unit;
    d[key] += sign * BigInt(amount) * BigInt(size);
    pos = UNIT_PATTERN.lastIndex;
    while (s[pos] === ' ' || s[pos] === ',' || s[pos] === '、') pos++;
  }
  return {
    years: durationNumber(d.years),
    months: durationNumber(d.months),
    days: durationNumber(d.days),
    ms: durationNumber(d.ms),
  };
}

/**
 * 日時に期間を足す。年・月・日はそのタイムゾーンの暦で足す（夏時間をまたいでも同じ時刻になる）。
 * 足した月にその日がなければ（1月31日 + 1ヶ月）、月末にそろえ、clamped を true にする
 */
export function addDuration(date: Date, d: Duration, zone: Zone): { date: Date; clamped: boolean } {
  /**
   * 暦を変えないときは、元の時刻に経過時間を足すだけにする。壁時計から時刻に戻すと、夏時間が終わる日の
   * 2回目の時刻（01:30 など）が1回目に置き換わり、1時間ずれるため
   */
  if (d.years === 0 && d.months === 0 && d.days === 0) return { date: checked(date.getTime() + d.ms), clamped: false };
  const w = wallOf(date.getTime(), zone);
  /** 年と月で大きな値が相殺される場合も、相殺する前に丸めない。 */
  const monthIndex = durationNumber(BigInt(w.y) * 12n + BigInt(w.mo - 1) + BigInt(d.years) * 12n + BigInt(d.months));
  const y = Math.floor(monthIndex / 12);
  const mo = monthIndex - y * 12 + 1;
  const last = daysInMonth(y, mo);
  const clamped = w.d > last;
  /** 壁時計の暦は Date に通さず計算し、時差を戻した実際の時刻で範囲を確認する。 */
  const day = daysFromCivil(y, mo, Math.min(w.d, last));
  const shiftedDay = day + d.days;
  /** 時差の1日と、後から足す経過時間で範囲内へ戻せる日数まで、中間の暦を許す。 */
  const calendarLimit = 100000001 + Math.ceil(Math.abs(d.ms) / 86400000);
  if (!Number.isSafeInteger(day) || !Number.isSafeInteger(shiftedDay) || Math.abs(shiftedDay) > calendarLimit) throw new DateRangeError();
  const wall: Wall = {
    ...civilFromDays(shiftedDay),
    h: w.h,
    mi: w.mi,
    s: w.s,
    ms: w.ms,
  };
  return { date: addZonedElapsed(wall, zone, d.ms), clamped };
}
