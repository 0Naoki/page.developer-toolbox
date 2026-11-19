import type { Dialect } from './parse';

/**
 * cron式の組み立て（画面の「式を組み立てる」）。選んだ頻度と時刻から、形式ごとの書き方の式を作る。
 *
 * @remarks
 * 曜日は、形式によって数字の数え方が違う（標準は 0 が日曜、Quartz・EventBridge は 1 が日曜）ため、どの形式でも同じ意味になる名前（MON など）で書く。
 * Quartz・EventBridge は日と曜日のどちらか一方を ? にする。Quartz は先頭に秒、EventBridge は末尾に年を足す。
 */

export type Frequency = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly';

export type CronSpec = {
  frequency: Frequency;
  /** 何分ごとか（minutes のとき。1〜59。1 は毎分） */
  interval: number;
  /** 分（hourly・daily・weekly・monthly のとき。0〜59） */
  minute: number;
  /** 時（daily・weekly・monthly のとき。0〜23） */
  hour: number;
  /** 曜日（weekly のとき。0 が日曜、6 が土曜） */
  weekdays: readonly number[];
  /** 日（monthly のとき。1〜31。31 日がない月は実行しない） */
  day: number;
};

/** 曜日の名前（0 が日曜）。どの形式でも読める */
const WEEKDAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

/** 曜日の並びを、3つ以上続く部分は範囲（MON-FRI）にして書く */
function weekdayField(weekdays: readonly number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j++;
    const from = WEEKDAY_NAMES[days[i]!];
    const to = WEEKDAY_NAMES[days[j]!];
    if (j - i >= 2) parts.push(`${from}-${to}`);
    /** 0〜6 は buildCron で確かめている（?? '' は型のためだけ） */
    else for (let k = i; k <= j; k++) parts.push(WEEKDAY_NAMES[days[k]!] ?? '');
    i = j + 1;
  }
  return parts.join(',');
}

/**
 * 頻度と時刻から cron式を作る。
 *
 * @returns 式。値が範囲外のときは、理由（画面に出す文言）を返す。
 */
export function buildCron(spec: CronSpec, dialect: Dialect): { ok: true; expression: string } | { ok: false; error: string } {
  const { frequency, interval, minute, hour, weekdays, day } = spec;
  if (frequency === 'minutes' && !inRange(interval, 1, 59)) return { ok: false, error: '何分ごとかは 1〜59 の整数で指定してください' };
  if (frequency !== 'minutes' && !inRange(minute, 0, 59)) return { ok: false, error: '分は 0〜59 の整数で指定してください' };
  if (frequency !== 'minutes' && frequency !== 'hourly' && !inRange(hour, 0, 23)) return { ok: false, error: '時は 0〜23 の整数で指定してください' };
  if (frequency === 'weekly' && (weekdays.length === 0 || weekdays.some((d) => !inRange(d, 0, 6)))) return { ok: false, error: '曜日を1つ以上選んでください' };
  if (frequency === 'monthly' && !inRange(day, 1, 31)) return { ok: false, error: '日は 1〜31 の整数で指定してください' };

  /** 日と曜日のどちらかを ? にする形式か */
  const exclusive = dialect === 'quartz' || dialect === 'aws';
  const minuteField = frequency === 'minutes' ? (interval === 1 ? '*' : `*/${interval}`) : String(minute);
  const hourField = frequency === 'minutes' || frequency === 'hourly' ? '*' : String(hour);
  const dayField = frequency === 'monthly' ? String(day) : frequency === 'weekly' && exclusive ? '?' : '*';
  const weekday = frequency === 'weekly' ? weekdayField(weekdays) : exclusive ? '?' : '*';
  const fields = [minuteField, hourField, dayField, '*', weekday];
  if (dialect === 'quartz') fields.unshift('0');
  if (dialect === 'aws') fields.push('*');
  return { ok: true, expression: fields.join(' ') };
}
