/** タイムゾーンの変換（UTC の時刻と、タイムゾーンの壁時計の日時）と、日時の範囲の検査。 */
import { daysFromCivil } from './civilTime';

/** IANA のタイムゾーン名（Asia/Tokyo・America/New_York・UTC など） */
export type Zone = string;

/** 日本時間のタイムゾーン名。各ツールの既定の表示と、cron の基準日時に使う。ツールでは直書きせずにこれを使う（静的検査あり） */
export const JST_ZONE: Zone = 'Asia/Tokyo';

/** タイムゾーン */

/** タイムゾーンの一覧を取れない古いブラウザ向けの、よく使うもの */
const FALLBACK_ZONES = [JST_ZONE, 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney'];

/** ブラウザが対応している IANA のタイムゾーン名の一覧 */
export function availableZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    /** 一覧に UTC が含まれないブラウザがあるため足す */
    if (list?.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    /** 下の一覧を使う */
  }
  return FALLBACK_ZONES;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** タイムゾーンごとの日時の部品の書式（作るのが重いため使い回す）。存在しない名前なら例外 */
function partsFormat(zone: Zone): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

/**
 * タイムゾーンの正式な表記（「asia/tokyo」→「Asia/Tokyo」）。存在しない名前なら null。
 * ブラウザは大文字小文字を区別せずに受け付けるため、一覧に追加する前にそろえる
 */
export function canonicalZone(zone: string): Zone | null {
  if (!zone.trim()) return null;
  try {
    return partsFormat(zone.trim()).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidZone(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    partsFormat(zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * 表示設定（localStorage）から読んだタイムゾーンの検証関数。
 * 書き換えられた長い値で Intl を試さないよう、IANA の名前に十分な長さ（128単位）までに限る
 */
export const isStoredZone = (value: unknown): value is Zone => typeof value === 'string' && value.length <= 128 && isValidZone(value);

/** 壁時計の日時（そのタイムゾーンの人が時計で見る日時） */
export type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number };

/**
 * 壁時計の日時を、UTC とみなしたときのミリ秒（0〜99 年も、その年として扱う）。
 * Date の範囲を少し超える壁時計（範囲の端の時刻を東京時間で見たときなど）も、NaN にせず計算する
 */
export function utcOf(w: Wall): number {
  return daysFromCivil(w.y, w.mo, w.d) * 86400000 + ((w.h * 60 + w.mi) * 60 + w.s) * 1000 + w.ms;
}

/** 時刻 ms の、そのタイムゾーンでの壁時計の日時 */
export function wallOf(ms: number, zone: Zone): Wall {
  const p: Record<string, string> = {};
  for (const part of partsFormat(zone).formatToParts(new Date(ms))) p[part.type] = part.value;
  const year = Number(p.year);
  return {
    /** 紀元前は「1 BC」= 0年、「2 BC」= -1年 */
    y: p.era === 'BC' || p.era === 'B' ? 1 - year : year,
    mo: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    mi: Number(p.minute),
    s: Number(p.second),
    ms: ((ms % 1000) + 1000) % 1000,
  };
}

/**
 * 時刻 ms での、UTC からのずれ（ミリ秒）。1888年より前の東京（+09:18:59）のように秒を含むことがあるため、
 * 日時の変換にはこちらを使う
 */
export const offsetMs = (ms: number, zone: Zone): number => utcOf(wallOf(ms, zone)) - ms;

/** Date で表せる時刻の上限（エポックから±1億日のミリ秒） */
export const MAX_DATE_MS = 8.64e15;

/**
 * 日時が Date で表せる範囲（エポックから±1億日）を超えた。
 *
 * @remarks
 * 夏時間で飛ばされる時刻（NonexistentTimeError）と区別する。範囲を超えた後の時刻はどれも範囲外なので、
 * 次の候補を探す処理（cron の次回実行など）は、この例外で探索を打ち切る
 */
export class DateRangeError extends Error {
  override name = 'DateRangeError';
  constructor() {
    super('日時の範囲を超えています');
  }
}

/** 夏時間への切り替えで飛ばされる、存在しない時刻。次の候補を探す処理は、この時刻だけを飛ばして続ける */
export class NonexistentTimeError extends Error {
  override name = 'NonexistentTimeError';
  constructor() {
    super('夏時間への切り替えで飛ばされる、存在しない時刻です');
  }
}

const sameWall = (a: Wall, b: Wall) => a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi && a.s === b.s;

/**
 * そのタイムゾーンの壁時計の日時を、時刻（ミリ秒）にする。
 * 夏時間が始まるときに飛ばされる時刻（存在しない時刻）は、strict なら例外、そうでなければずれた時刻を返す。
 * 夏時間が終わるときに2回ある時刻は、先（夏時間）のほうを返す
 */
export function zonedToUtc(w: Wall, zone: Zone, strict = true): number {
  return utcOf(w) - resolveZonedOffset(w, zone, strict, false);
}

/**
 * 夏時間への切り替えで飛ばされる壁時計 w について、飛ばされる区間の終わり（切り替えの後の最初の壁時計の日時）を返す。
 *
 * @remarks
 * 区間の長さはゾーンによって違う（Australia/Lord_Howe は30分、Pacific/Apia の 2011-12-30 は丸1日）ため、
 * 切り替えの時刻を二分探索で求める。前後1日のずれが切り替え1回分の形でないとき（w が存在する時刻のときなど）は、w をそのまま返す。
 * 次の候補を順に試す探索（cron の次回実行など）が、区間の中の候補ごとに変換を試さずに済むようにするためのもの。
 */
export function nonexistentGapEnd(w: Wall, zone: Zone): Wall {
  const guess = utcOf(w);
  const near = (t: number) => Math.min(MAX_DATE_MS, Math.max(-MAX_DATE_MS, t));
  const before = offsetMs(near(guess - 86400000), zone);
  const after = offsetMs(near(guess + 86400000), zone);
  /** w は「切り替え前のずれ」で読むと切り替えの後、「切り替え後のずれ」で読むと切り替えの前の時刻になる */
  let lo = guess - after;
  let hi = guess - before;
  if (!(lo < hi) || Math.abs(lo) > MAX_DATE_MS || Math.abs(hi) > MAX_DATE_MS) return w;
  const loOffset = offsetMs(lo, zone);
  if (loOffset !== before || offsetMs(hi, zone) !== after) return w;
  /** lo は切り替えの前、hi は切り替えの後の時刻のまま、間を1ミリ秒まで詰める */
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetMs(mid, zone) === loOffset) lo = mid;
    else hi = mid;
  }
  return wallOf(hi, zone);
}

/**
 * 暦で求めた壁時計を時刻に戻し、経過ミリ秒を足してから Date の範囲を確認する。
 * 時刻と経過ミリ秒の相殺は BigInt で終えてから範囲を確かめる（安全な整数を超える中間の値でも端数を丸めない）。
 * 範囲外の中間時刻のオフセットは、Date で参照できる最寄りの境界の値を使う。
 * 夏時間の欠けた時刻はずらし、重複する時刻は1回目を使う（期間計算の規則）。
 */
export function addZonedElapsed(w: Wall, zone: Zone, elapsedMs: number): Date {
  const offset = resolveZonedOffset(w, zone, false, true);
  /** 中間のミリ秒は安全な整数の範囲を超え得るため、経過時間との相殺が終わるまで整数で保つ。 */
  const calendarMs = BigInt(daysFromCivil(w.y, w.mo, w.d)) * 86400000n + BigInt(((w.h * 60 + w.mi) * 60 + w.s) * 1000 + w.ms);
  const result = calendarMs - BigInt(offset) + BigInt(elapsedMs);
  if (result < -8640000000000000n || result > 8640000000000000n) throw new DateRangeError();
  return checked(Number(result));
}

/** 壁時計に対応する候補のオフセットを選ぶ。期間計算だけは、経過時間を足す前の範囲外を許す。 */
function resolveZonedOffset(w: Wall, zone: Zone, strict: boolean, allowOutside: boolean): number {
  const guess = utcOf(w);
  /**
   * ずれは時刻によって変わるため、前後のずれで2回試す
   * 分に丸めたずれを使うと、秒を含むずれの時代で候補が秒単位でずれ、存在する日時も見つからなくなる
   */
  /** 前後1日の時刻は、Date の範囲の端では範囲を超えるため、範囲内に寄せてずれを調べる */
  const near = (t: number) => Math.min(MAX_DATE_MS, Math.max(-MAX_DATE_MS, t));
  const offsets: [number, number] = [offsetMs(near(guess - 86400000), zone), offsetMs(near(guess + 86400000), zone)];
  const candidates = offsets.map((offset) => ({ time: guess - offset, offset }));
  const inRange = candidates.filter((c) => Math.abs(c.time) <= MAX_DATE_MS);
  if (inRange.length === 0) {
    if (allowOutside) return offsets[0];
    throw new DateRangeError();
  }
  const matched = inRange.filter((c) => sameWall(wallOf(c.time, zone), w)).sort((a, b) => a.time - b.time);
  const [earliest] = matched;
  if (earliest) return earliest.offset;
  if (strict) throw new NonexistentTimeError();
  return offsets[0];
}

/** Date で表せる範囲（±1億日）かを確かめる */
export function checked(ms: number): Date {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new DateRangeError();
  return date;
}
