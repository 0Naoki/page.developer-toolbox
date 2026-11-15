import { formatNumber } from '../../lib/number';
import { detailPreview } from '../../lib/text/textPreview';
/**
 * unix：crontab・GitHub Actions の5項目。日曜は 0 または 7。
 * kubernetes：CronJob の5項目。日曜は 0、単一値からの間隔指定も受け付ける。
 * quartz：Quartz の6〜7項目（先頭が秒、年は省略可）。日曜は 1。
 * aws：Amazon EventBridge の6項目（末尾が年）。日曜は 1。
 */
export type Dialect = 'unix' | 'kubernetes' | 'quartz' | 'aws';

/** 秒・年のない5項目の形式か。日と曜日に ? の排他指定を要求しない */
const isFiveField = (dialect: Dialect) => dialect === 'unix' || dialect === 'kubernetes';

export type FieldName = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'weekday' | 'year';

type FieldSpec = {
  label: string;
  min: number;
  max: number;
  /** 値の後ろに付ける語（9時、15日） */
  suffix: string;
  /** 「○○ごと」の単位 */
  every: string;
  names?: readonly string[];
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const SPECS: Record<FieldName, FieldSpec> = {
  second: { label: '秒', min: 0, max: 59, suffix: '秒', every: '秒' },
  minute: { label: '分', min: 0, max: 59, suffix: '分', every: '分' },
  hour: { label: '時', min: 0, max: 23, suffix: '時', every: '時間' },
  day: { label: '日', min: 1, max: 31, suffix: '日', every: '日' },
  month: { label: '月', min: 1, max: 12, suffix: '月', every: 'か月', names: MONTHS },
  weekday: { label: '曜日', min: 1, max: 7, suffix: '曜日', every: '日', names: WEEKDAYS },
  year: { label: '年', min: 1970, max: 2199, suffix: '年', every: '年' },
};

const UNIX_WEEKDAY: FieldSpec = { ...SPECS.weekday, min: 0, max: 7 };
const KUBERNETES_WEEKDAY: FieldSpec = { ...SPECS.weekday, min: 0, max: 6 };

const LAYOUTS: Record<Dialect, FieldName[]> = {
  unix: ['minute', 'hour', 'day', 'month', 'weekday'],
  kubernetes: ['minute', 'hour', 'day', 'month', 'weekday'],
  quartz: ['second', 'minute', 'hour', 'day', 'month', 'weekday', 'year'],
  aws: ['minute', 'hour', 'day', 'month', 'weekday', 'year'],
};

const MACROS: Record<string, string> = {
  '@YEARLY': '0 0 1 1 *',
  '@ANNUALLY': '0 0 1 1 *',
  '@MONTHLY': '0 0 1 * *',
  '@WEEKLY': '0 0 * * 0',
  '@DAILY': '0 0 * * *',
  '@MIDNIGHT': '0 0 * * *',
  '@HOURLY': '0 * * * *',
};

/** 入力の上限。カンマで大量に並べた式で、入力のたびの計算が重くならないように */
export const MAX_INPUT = 1000;
type Item = { start: number; end: number; step: number; star: boolean };

/** L・W・# を使う指定。Quartz と EventBridge の日と曜日にだけ書ける */
export type Special =
  | { kind: 'last'; offset: number } /** L、L-3 */
  | { kind: 'lastWeekday' } /** LW */
  | { kind: 'nearestWeekday'; day: number } /** 15W */
  | { kind: 'lastDow'; dow: number } /** 6L */
  | { kind: 'nthDow'; dow: number; n: number }; /** 6#3 */

export type CronField = {
  name: FieldName;
  label: string;
  /** 書かれた文字列 */
  source: string;
  items: Item[];
  /** 一致する値（小さい順）。曜日は 0（日）〜 6（土）にそろえる */
  values: number[];
  /** ? で指定を省いた */
  omitted: boolean;
  special?: Special;
};

export type CronExpression = {
  dialect: Dialect;
  fields: CronField[];
  /** \@daily などのマクロを展開した式 */
  expanded: string | null;
};

const range = (min: number, max: number): number[] => Array.from({ length: max - min + 1 }, (_, i) => min + i);

function parseNumber(text: string, spec: FieldSpec): number {
  const index = spec.names?.indexOf(text) ?? -1;
  /** 曜日の名前は、標準の cron では SUN=0、Quartz と EventBridge では SUN=1 */
  if (index !== -1) return index + spec.min;
  if (!/^\d{1,4}$/.test(text)) throw new Error(`${spec.label}の「${detailPreview(text)}」を読めません`);
  const value = Number(text);
  if (value < spec.min || value > spec.max) throw new Error(`${spec.label}の「${detailPreview(text)}」が範囲外です（${spec.min}〜${spec.max}）`);
  return value;
}

function parseItem(token: string, name: FieldName, spec: FieldSpec, dialect: Dialect): Item {
  const pieces = token.split('/');
  if (pieces.length > 2) throw new Error(`${spec.label}の「${detailPreview(token)}」を読めません`);
  const [body = '', stepText] = pieces;
  let step = 1;
  if (stepText !== undefined) {
    if (!/^[1-9]\d{0,3}$/.test(stepText)) throw new Error(`${spec.label}の「${detailPreview(token)}」の間隔は1以上の整数にしてください`);
    step = Number(stepText);
  }
  if (body === '*' || (dialect === 'kubernetes' && body === '?')) {
    /** 標準の cron の曜日は 0〜7 と書けるが、* は日曜を2回数えないよう 0〜6 とする */
    return { start: spec.min, end: name === 'weekday' && dialect === 'unix' ? 6 : spec.max, step, star: true };
  }
  const bounds = body.split('-');
  if (bounds.length > 2) throw new Error(`${spec.label}の「${detailPreview(token)}」を読めません`);
  const [startText = '', endText] = bounds;
  const start = parseNumber(startText, spec);
  if (endText === undefined) {
    if (stepText === undefined) return { start, end: start, step, star: false };
    if (dialect === 'unix') throw new Error(`${spec.label}の「${detailPreview(token)}」は標準の cron では書けません。「${start}-${spec.max}/${step}」と書いてください`);
    return { start, end: spec.max, step, star: false };
  }
  const end = parseNumber(endText, spec);
  if (start > end && isFiveField(dialect)) throw new Error(`${spec.label}の「${detailPreview(token)}」は開始が終了より後です`);
  return { start, end, step, star: false };
}

/** 範囲の値。Quartz の FRI-MON のように開始が終了より後なら、最大値の次で最小値に戻る */
function expand(item: Item, spec: FieldSpec): number[] {
  const size = spec.max - spec.min + 1;
  const span = item.end >= item.start ? item.end - item.start : item.end - item.start + size;
  const values: number[] = [];
  for (let i = 0; i <= span; i += item.step) values.push(spec.min + ((item.start - spec.min + i) % size));
  return values;
}

export const normalizeDow = (value: number, dialect: Dialect) => (isFiveField(dialect) ? value % 7 : value - 1);

function parseSpecial(text: string, name: FieldName, spec: FieldSpec, dialect: Dialect): Special | null {
  if (isFiveField(dialect)) return null;
  if (name === 'day') {
    if (text === 'L') return { kind: 'last', offset: 0 };
    if (text === 'LW') return { kind: 'lastWeekday' };
    const last = /^L-(\d{1,2})$/.exec(text);
    if (last) {
      if (Number(last[1]) > 30) throw new Error(`${spec.label}の「${detailPreview(text)}」が範囲外です（L-1〜L-30）`);
      return { kind: 'last', offset: Number(last[1]) };
    }
    const nearest = /^(\d{1,2})W$/.exec(text);
    if (nearest) return { kind: 'nearestWeekday', day: parseNumber(nearest[1] ?? '', spec) };
  }
  if (name === 'weekday') {
    const last = /^(.+)L$/.exec(text);
    if (last) return { kind: 'lastDow', dow: normalizeDow(parseNumber(last[1] ?? '', spec), dialect) };
    const nth = /^(.+)#(\d)$/.exec(text);
    if (nth) {
      const n = Number(nth[2]);
      if (n < 1 || n > 5) throw new Error(`${spec.label}の「${detailPreview(text)}」は第1〜第5で指定してください`);
      return { kind: 'nthDow', dow: normalizeDow(parseNumber(nth[1] ?? '', spec), dialect), n };
    }
  }
  return null;
}

function parseField(text: string, name: FieldName, dialect: Dialect): CronField {
  const spec = name === 'weekday' && isFiveField(dialect)
    ? (dialect === 'unix' ? UNIX_WEEKDAY : KUBERNETES_WEEKDAY) : SPECS[name];
  const base = { name, label: spec.label, source: text };
  const all = name === 'weekday' ? range(0, 6) : range(spec.min, spec.max);
  if (text === '?' && dialect !== 'kubernetes') {
    if (dialect === 'unix') throw new Error('標準の cron では ? は使えません。* を使ってください');
    if (name !== 'day' && name !== 'weekday') throw new Error(`? は日と曜日にだけ使えます（${spec.label}に書かれています）`);
    return { ...base, items: [], values: all, omitted: true };
  }
  const special = parseSpecial(text, name, spec, dialect);
  if (special) return { ...base, items: [], values: [], omitted: false, special };
  /** 曜日の L だけなら、「最終」ではなく 7（土曜日）と同じ。最終土曜日は 7L と書く */
  const body = name === 'weekday' && !isFiveField(dialect) && text === 'L' ? '7' : text;
  const items = body.split(',').map((token) => {
    if (token === '') throw new Error(`${spec.label}の「${detailPreview(text)}」に空の項目があります`);
    return parseItem(token, name, spec, dialect);
  });
  const values = new Set<number>();
  for (const item of items) {
    for (const value of expand(item, spec)) values.add(name === 'weekday' ? normalizeDow(value, dialect) : value);
  }
  return { ...base, items, values: [...values].sort((a, b) => a - b), omitted: false };
}

const FIELD_COUNT_ERRORS: Record<Dialect, string> = {
  unix: '標準の cron は「分 時 日 月 曜日」の5項目です。コマンドは含めないでください。秒や年があるときは Quartz か EventBridge を選んでください',
  kubernetes: 'Kubernetes は「分 時 日 月 曜日」の5項目です。コマンドは含めないでください',
  quartz: 'Quartz は「秒 分 時 日 月 曜日」の6項目、または末尾に年を足した7項目です',
  aws: 'EventBridge は「分 時 日 月 曜日 年」の6項目です',
};

export function parseCron(input: string, dialect: Dialect): CronExpression {
  if (input.length > MAX_INPUT) throw new Error(`cron式は${formatNumber(MAX_INPUT)}文字までです`);
  let text = input.trim().toUpperCase();
  /** EventBridge のコンソールや設定ファイルの書き方 */
  if (dialect === 'aws') text = text.replace(/^CRON\((.*)\)$/, '$1').trim();
  let expanded: string | null = null;
  if (text.startsWith('@')) {
    if (!isFiveField(dialect)) throw new Error('@daily などのマクロは標準の cron と Kubernetes で使えます');
    if (text === '@REBOOT') throw new Error('@reboot は起動時に1回実行する指定で、次回の実行時刻は決まりません');
    expanded = MACROS[text] ?? null;
    if (!expanded) throw new Error(`「${detailPreview(input.trim())}」は知らないマクロです（@yearly・@monthly・@weekly・@daily・@hourly が使えます）`);
    text = expanded;
  }
  const tokens = text.split(/\s+/);
  const layout = LAYOUTS[dialect];
  /** Quartz の年は省略できる */
  const names = dialect === 'quartz' && tokens.length === 6 ? layout.slice(0, 6) : layout;
  if (tokens.length !== names.length) throw new Error(`${FIELD_COUNT_ERRORS[dialect]}（${tokens.length}項目あります）`);
  /** 項目の数は上で確かめている（?? '' は型のためだけ） */
  const fields = names.map((name, i) => parseField(tokens[i] ?? '', name, dialect));
  if (!isFiveField(dialect)) {
    const day = fieldOf(fields, 'day')!;
    const weekday = fieldOf(fields, 'weekday')!;
    if (day.omitted === weekday.omitted) throw new Error('日と曜日のどちらか一方だけを ? にしてください');
  }
  return { dialect, fields, expanded };
}

export const fieldOf = (fields: CronField[], name: FieldName) => fields.find((f) => f.name === name);

/**
 * 5項目の形式で、日と曜日を OR として扱うか。
 * 標準では * で始まる項目（*\/2 も含む）は指定なしとする。
 * Kubernetes では *・? の間隔が1の場合だけ指定なしとし、*\/2 は OR の対象になる。
 */
export function isDayOrWeekday(cron: CronExpression): boolean {
  const day = fieldOf(cron.fields, 'day')!;
  const weekday = fieldOf(cron.fields, 'weekday')!;
  if (cron.dialect === 'kubernetes') {
    const hasWildcard = (field: CronField) => field.items.some((item) => item.star && item.step === 1);
    return !hasWildcard(day) && !hasWildcard(weekday);
  }
  return cron.dialect === 'unix' && !day.source.startsWith('*') && !weekday.source.startsWith('*');
}
