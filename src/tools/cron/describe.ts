import { WEEKDAYS_JA } from '../../lib/time/date';
import { SPECS, fieldOf, isDayOrWeekday, normalizeDow, type CronExpression, type CronField, type Dialect, type Special } from './parse';

const pad = (n: number) => String(n).padStart(2, '0');

const specOf = (f: CronField) => SPECS[f.name];

const valueLabel = (f: CronField, value: number, dialect: Dialect): string => {
  if (f.name !== 'weekday') return String(value);
  return WEEKDAYS_JA[normalizeDow(value, dialect)] ?? String(value);
};

/** 項目を「1〜5日」「15分ごと」のように読み下す */
function listText(f: CronField, dialect: Dialect): string {
  const { suffix, every } = specOf(f);
  const plain: string[] = [];
  const stepped: string[] = [];
  for (const item of f.items) {
    const text = item.start === item.end ? valueLabel(f, item.start, dialect) : `${valueLabel(f, item.start, dialect)}〜${valueLabel(f, item.end, dialect)}`;
    if (item.step === 1) plain.push(item.star ? '毎' : text);
    else if (item.star) stepped.push(`${item.step}${every}ごと`);
    else stepped.push(`${text}${suffix}の${item.step}${every}ごと`);
  }
  return [...(plain.length > 0 ? [`${plain.join('、')}${suffix}`] : []), ...stepped].join('、');
}

/** 項目が1つだけなら、その項目 */
const onlyItem = (f: CronField) => (f.items.length === 1 ? f.items[0] : undefined);
const isEvery = (f: CronField | undefined) => {
  if (f === undefined || f.omitted) return true;
  const item = onlyItem(f);
  return item !== undefined && item.star && item.step === 1;
};
const isStep = (f: CronField) => {
  const item = onlyItem(f);
  return item !== undefined && item.star && item.step > 1;
};
const isSingle = (f: CronField) => f.values.length === 1 && !f.special;

function timeText(cron: CronExpression): string {
  const { fields, dialect } = cron;
  const second = fieldOf(fields, 'second');
  const minute = fieldOf(fields, 'minute')!;
  const hour = fieldOf(fields, 'hour')!;
  if (isSingle(hour) && isSingle(minute) && (!second || isSingle(second))) {
    /** isSingle なので、値はどれも1つだけある */
    const [h = 0] = hour.values;
    const [m = 0] = minute.values;
    const s = second?.values[0] ?? 0;
    return `${pad(h)}:${pad(m)}${s === 0 ? '' : `:${pad(s)}`}`;
  }
  let text: string;
  if (isEvery(hour)) text = isEvery(minute) ? '毎分' : isStep(minute) ? listText(minute, dialect) : `毎時${listText(minute, dialect)}`;
  else if (isEvery(minute)) text = isStep(hour) ? `${listText(hour, dialect)}の毎分` : `${listText(hour, dialect)}台の毎分`;
  else text = `${listText(hour, dialect)}の${listText(minute, dialect)}`;
  if (!second || (isSingle(second) && second.values[0] === 0)) return text;
  const everyMinute = isEvery(hour) && isEvery(minute);
  if (isEvery(second)) return everyMinute ? '毎秒' : `${text}の毎秒`;
  if (!everyMinute) return `${text}の${listText(second, dialect)}`;
  return isStep(second) ? listText(second, dialect) : `毎分${listText(second, dialect)}`;
}

function specialText(s: Special): string {
  switch (s.kind) {
    case 'last':
      return s.offset === 0 ? '月末' : `月末の${s.offset}日前`;
    case 'lastWeekday':
      return '月末の平日';
    case 'nearestWeekday':
      return `${s.day}日に最も近い平日`;
    case 'lastDow':
      return `最終${WEEKDAYS_JA[s.dow]}曜日`;
    case 'nthDow':
      return `第${s.n}${WEEKDAYS_JA[s.dow]}曜日`;
  }
}

/** 日と曜日の指定を読み下す。指定がなければ null */
const dayPartText = (f: CronField, dialect: Dialect): string | null => {
  if (f.special) return specialText(f.special);
  return isEvery(f) ? null : listText(f, dialect);
};

function dateText(cron: CronExpression): string {
  const { fields, dialect } = cron;
  const month = fieldOf(fields, 'month')!;
  const year = fieldOf(fields, 'year');
  const day = dayPartText(fieldOf(fields, 'day')!, dialect);
  const weekday = dayPartText(fieldOf(fields, 'weekday')!, dialect);
  const scope = [
    ...(year && !isEvery(year) ? [listText(year, dialect)] : []),
    ...(!isEvery(month) ? [listText(month, dialect)] : []),
  ].join('');
  const target = day && weekday ? `${day}${isDayOrWeekday(cron) ? 'または' : 'かつ'}${weekday}` : day ?? weekday;
  if (!target) return scope ? `${scope}の毎日` : '毎日';
  /** 「1月1日」と続けて読める日付だけ「の」を省く */
  if (scope) return `${scope}${/^\d+(、\d+)*日$/.test(target) ? '' : 'の'}${target}`;
  const weekly = !day && !fieldOf(fields, 'weekday')!.special;
  return `${weekly ? '毎週' : '毎月'}${target}`;
}

/** 式の意味を一文で説明する */
export function describeCron(cron: CronExpression): string {
  const date = dateText(cron);
  /** 「毎日 5分ごと」は「毎日」がなくても意味が同じ */
  return date === '毎日' && isEvery(fieldOf(cron.fields, 'hour')) ? timeText(cron) : `${date} ${timeText(cron)}`;
}

export type FieldRow = { label: string; source: string; meaning: string };

/** 項目ごとの内訳 */
export function fieldRows(cron: CronExpression): FieldRow[] {
  return cron.fields.map((f) => {
    const { suffix } = specOf(f);
    let meaning: string;
    if (f.special) meaning = specialText(f.special);
    else if (f.omitted) meaning = '指定なし';
    else if (isEvery(f)) meaning = 'すべて';
    else meaning = `${f.values.map((v) => (f.name === 'weekday' ? WEEKDAYS_JA[v] : v)).join('、')}${suffix}`;
    return { label: f.label, source: f.source, meaning };
  });
}

/** 書いたとおりに動かない、または実装によって動作が異なる指定の注意 */
export function cronWarnings(cron: CronExpression): string[] {
  const warnings: string[] = [];
  const day = fieldOf(cron.fields, 'day')!;
  const weekday = fieldOf(cron.fields, 'weekday')!;
  const dayOrWeekday = isDayOrWeekday(cron);
  if (dayOrWeekday) {
    warnings.push('日と曜日の両方を指定すると、どちらかに一致した日に実行します（両方に一致した日だけではありません）');
  } else if (cron.dialect === 'unix' && !isEvery(day) && !isEvery(weekday)) {
    warnings.push('*/2 のように * で始まる日と曜日の組み合わせは、実装で動作が異なります。ここでは Linux の cron と同じく、両方に一致した日とします');
  }
  for (const f of cron.fields) {
    if (f.name === 'weekday' || f.name === 'year' || f.items.length !== 1 || !isStep(f)) continue;
    const { min, max, suffix } = specOf(f);
    const step = onlyItem(f)?.step ?? 1;
    if ((max - min + 1) % step === 0) continue;
    const last = f.values[f.values.length - 1];
    warnings.push(`${f.label}の ${f.source} は、区切りごとに数え直すため間隔が一定になりません（${last}${suffix}の次は${f.values[0]}${suffix}）`);
  }
  const firstDay = day.special?.kind === 'nearestWeekday' ? day.special.day : day.special || day.omitted ? 0 : day.values[0] ?? 0;
  if (firstDay >= 29 && !dayOrWeekday) warnings.push(`${firstDay}日がない月には実行されません`);
  return warnings;
}
