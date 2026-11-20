import { WEEKDAYS_JA, dayOfWeek, daysInMonth } from '../../lib/time/date';
import { formatInZone, formatWithOffset } from '../../lib/time/dateTimeFormat';
import { DateRangeError, NonexistentTimeError, nonexistentGapEnd, utcOf, wallOf, zonedToUtc, type Wall, type Zone } from '../../lib/time/timezone';
import { fieldOf, isDayOrWeekday, type CronExpression, type CronField, type FieldName } from './parse';

/** この年数の先まで探して見つからなければ「実行されない」とする（2月29日と曜日の組み合わせや、年の指定も見つかる長さ） */
export const SEARCH_YEARS = 200;

/** day（その月にある日）が土日なら、同じ月の中で最も近い平日 */
function nearestWeekday(y: number, m: number, day: number): number {
  const dow = dayOfWeek({ y, m, d: day });
  if (dow === 6) return day > 1 ? day - 1 : day + 2;
  if (dow === 0) return day < daysInMonth(y, m) ? day + 1 : day - 2;
  return day;
}

function matchesDay(f: CronField, y: number, m: number, d: number): boolean {
  const s = f.special;
  if (!s) return f.values.includes(d);
  const last = daysInMonth(y, m);
  if (s.kind === 'last') return d === last - s.offset;
  if (s.kind === 'lastWeekday') return d === nearestWeekday(y, m, last);
  /** 31W は31日がある月だけ実行する（月末に置き換えない。Quartz と同じ） */
  return s.kind === 'nearestWeekday' && s.day <= last && d === nearestWeekday(y, m, s.day);
}

function matchesWeekday(f: CronField, y: number, m: number, d: number): boolean {
  const dow = dayOfWeek({ y, m, d });
  const s = f.special;
  if (!s) return f.values.includes(dow);
  if (s.kind === 'lastDow') return dow === s.dow && d + 7 > daysInMonth(y, m);
  return s.kind === 'nthDow' && dow === s.dow && Math.ceil(d / 7) === s.n;
}

function matchesDate(cron: CronExpression, y: number, m: number, d: number): boolean {
  const day = matchesDay(fieldOf(cron.fields, 'day')!, y, m, d);
  const weekday = matchesWeekday(fieldOf(cron.fields, 'weekday')!, y, m, d);
  return isDayOrWeekday(cron) ? day || weekday : day && weekday;
}

/** 壁時計の日時で a が b より後か */
function isAfter(a: Omit<Wall, 'ms'>, b: Wall): boolean {
  const pairs: [number, number][] = [[a.y, b.y], [a.mo, b.mo], [a.d, b.d], [a.h, b.h], [a.mi, b.mi], [a.s, b.s]];
  for (const [left, right] of pairs) if (left !== right) return left > right;
  return false;
}

/**
 * from より後の実行時刻（ミリ秒）を、早い順に最大 count 件返す。式はタイムゾーン zone の壁時計で読む。
 * 夏時間で飛ばされる時刻は実行せず、2回ある時刻は1回目だけ実行する（実装によって動作が異なる）。
 */
export function nextRuns(cron: CronExpression, zone: Zone, from: number, count: number): number[] {
  const runs: number[] = [];
  const start = wallOf(from, zone);
  const valuesOf = (name: FieldName, fallback: number[]) => fieldOf(cron.fields, name)?.values ?? fallback;
  const years = fieldOf(cron.fields, 'year')?.values;
  const months = valuesOf('month', []);
  const hours = valuesOf('hour', []);
  const minutes = valuesOf('minute', []);
  const seconds = valuesOf('second', [0]);
  /**
   * 夏時間で飛ばされる区間の終わり（壁時計を UTC とみなしたミリ秒）。これより前の候補は変換を試さずに飛ばす。
   * 候補ごとに変換を試すと、区間の中のすべての候補（毎秒の式なら1時間で3,600件）で重い変換を繰り返し、
   * 全候補が飛ばされる式（America/New_York の「* * 2 ? 3 SUN#2」など）では200年分を試して画面が止まるため
   */
  let skipUntil = -Infinity;
  for (let y = start.y; y <= start.y + SEARCH_YEARS; y++) {
    if (years && !years.includes(y)) continue;
    for (const mo of months) {
      if (y === start.y && mo < start.mo) continue;
      const first = y === start.y && mo === start.mo ? start.d : 1;
      for (let d = first; d <= daysInMonth(y, mo); d++) {
        if (!matchesDate(cron, y, mo, d)) continue;
        for (const h of hours) {
          for (const mi of minutes) {
            for (const s of seconds) {
              if (!isAfter({ y, mo, d, h, mi, s }, start)) continue;
              const wall: Wall = { y, mo, d, h, mi, s, ms: 0 };
              if (utcOf(wall) < skipUntil) continue;
              let time: number;
              try {
                time = zonedToUtc(wall, zone);
              } catch (error) {
                /**
                 * 夏時間で飛ばされる時刻を飛ばす。同じ区間の残りの候補もまとめて飛ばす
                 * （区間の長さはゾーンで違うため、同じ「時」を飛ばすのではなく、区間の終わりまでを飛ばす）
                 */
                if (error instanceof NonexistentTimeError) {
                  skipUntil = utcOf(nonexistentGapEnd(wall, zone));
                  continue;
                }
                /**
                 * Date で表せる範囲を超えたら、それより後の候補もすべて範囲外なので探索を終える
                 * （範囲外の候補を200年分試し続けると、同期の計算で画面が止まるため）
                 */
                if (error instanceof DateRangeError) return runs;
                throw error;
              }
              /** 夏時間の終わりでは、壁時計が後でも from より前の時刻になることがある */
              if (time <= from) continue;
              runs.push(time);
              if (runs.length === count) return runs;
            }
          }
        }
      }
    }
  }
  return runs;
}

/**
 * 実行日時の表示。「2026-10-05 09:00:00（月）」の形で、曜日は zone の現地の日付で決める。
 *
 * @remarks
 * 基準日時の欄（日本時間として読む）に貼り戻しても同じ時刻になるよう、日本時間以外の表示には withOffset で
 * UTC からのずれを付ける（「2026-10-04 20:00:00 -04:00（日）」）。曜日の添え書きは、日時の入力（parseDateTime）が読み飛ばす。
 */
export function formatRun(ms: number, zone: Zone, withOffset = false): string {
  const { y, mo, d } = wallOf(ms, zone);
  const date = new Date(ms);
  return `${withOffset ? formatWithOffset(date, zone) : formatInZone(date, zone)}（${WEEKDAYS_JA[dayOfWeek({ y, m: mo, d })]}）`;
}
