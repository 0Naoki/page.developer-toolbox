/** 日時の表示の書式（タイムゾーンを明示した表示と、今からの相対的な表示）。 */
import { JST_ZONE, offsetMs, wallOf, type Wall, type Zone } from './timezone';

/** UTC からのずれを「+09:00」の形にする */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** 表示 */

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

/** これより前の日時は、下の書式では年が4桁にならず、紀元前も正の年になる（タイムゾーンの差を見込んで2日の余裕をとる） */
const MIN_DISPLAY_FORMAT_MS = Date.UTC(1000, 0, 3);

/** これより後の日時は、下の書式では年が5桁以上になり、符号が付かない（タイムゾーンの差を見込んで2日の余裕をとる） */
const MAX_DISPLAY_FORMAT_MS = Date.UTC(9999, 11, 30);

/**
 * 壁時計の日時を「0999-01-02 03:04:05」の形にする。年は ISO8601 と同じく、紀元前1年が 0 で、その前が負の数。
 * 0〜9999年の外は、ISO8601 の拡張年（「+010000」「-000001」）で書き、parseDateTime で読み戻せるようにする
 */
function formatWall({ y, mo, d, h, mi, s }: Wall): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = y >= 0 && y <= 9999 ? String(y).padStart(4, '0') : `${y < 0 ? '-' : '+'}${String(Math.abs(y)).padStart(6, '0')}`;
  return `${year}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

/**
 * 「2026-10-02 09:00:00」の形。書式のオブジェクトは作るのが重い（ログの一括変換で数万回呼ぶと、
 * 作り直すだけで1秒以上かかる）ため、タイムゾーンごとに使い回す
 */
export function formatInZone(date: Date, zone: Zone): string {
  if (date.getTime() < MIN_DISPLAY_FORMAT_MS || date.getTime() > MAX_DISPLAY_FORMAT_MS) return formatWall(wallOf(date.getTime(), zone));
  let f = displayFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    displayFormatters.set(zone, f);
  }
  return f.format(date);
}

/** 日本時間の「2026-10-02 09:00:00」の形（末尾に「JST」は付けない。見出しや表の列で JST と示す画面向け） */
export const formatJst = (date: Date): string => formatInZone(date, JST_ZONE);

/**
 * 日本時間の「2026-10-02 09:00:00 JST」の形（1つの値だけで日本時間と分かるように示す画面向け）。
 * withMillis ならミリ秒も付ける（「09:00:00.123 JST」。showsMillis で決める）
 */
export const formatJstLabeled = (date: Date, withMillis = false): string => {
  const millis = withMillis ? `.${String(((date.getTime() % 1000) + 1000) % 1000).padStart(3, '0')}` : '';
  return `${formatJst(date)}${millis} JST`;
};

/**
 * 日時の表示にミリ秒を含めるか。画面・一括変換のどちらもこれで決める。
 *
 * @remarks
 * 1秒未満の端数がある時刻は必ず含め、表示をコピーして日時入力に貼り戻しても端数を失わないようにする。
 * 端数がなくても、入力がミリ秒以上の精度で書かれていた場合（ミリ秒単位のエポック、小数部を書いた秒・日時）は、
 * 入力と同じ精度で「.000」まで表示する（ログの一括変換で桁をそろえるため）。
 *
 * @param subSecondInput 入力がミリ秒以上の精度で書かれていたか
 */
export const showsMillis = (date: Date, subSecondInput = false): boolean => subSecondInput || date.getTime() % 1000 !== 0;

/** 日時の文字列に、秒の小数部が書かれているか（「09:00:00.000」など） */
export const hasWrittenFraction = (input: string): boolean => /:\d{2}\.\d/.test(input);

/** 「2026-10-02 09:00:00 +09:00」の形。withMillis ならミリ秒も付ける（showsMillis で決める） */
export function formatWithOffset(date: Date, zone: Zone, withMillis = false): string {
  const ms = date.getTime();
  const millis = withMillis ? `.${String(((ms % 1000) + 1000) % 1000).padStart(3, '0')}` : '';
  const offset = offsetMs(ms, zone);
  const minutes = formatOffset(Math.floor(Math.abs(offset) / 60000)).slice(1);
  const seconds = Math.floor(Math.abs(offset) / 1000) % 60;
  const suffix = seconds ? `:${String(seconds).padStart(2, '0')}` : '';
  return `${formatInZone(date, zone)}${millis} ${offset < 0 ? '-' : '+'}${minutes}${suffix}`;
}

export function relativeFrom(date: Date, now: number): string {
  const diff = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? '後' : '前';
  if (abs < 60) return abs === 0 ? '現在' : `${abs}秒${suffix}`;
  if (abs < 3600) return `${Math.floor(abs / 60)}分${suffix}`;
  if (abs < 86400) return `${Math.floor(abs / 3600)}時間${suffix}`;
  return `${Math.floor(abs / 86400)}日${suffix}`;
}
