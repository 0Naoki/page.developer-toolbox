import { compareYmd, isValidYmd, parseYmd, toHalfWidthDigits, type Ymd } from '../../lib/time/date';

export type Era = { name: string; short: string; start: Ymd };

/** 新しい順。明治は改暦（グレゴリオ暦採用）後の明治6年1月1日から対応 */
const ERAS: Era[] = [
  { name: '令和', short: 'R', start: { y: 2019, m: 5, d: 1 } },
  { name: '平成', short: 'H', start: { y: 1989, m: 1, d: 8 } },
  { name: '昭和', short: 'S', start: { y: 1926, m: 12, d: 25 } },
  { name: '大正', short: 'T', start: { y: 1912, m: 7, d: 30 } },
  { name: '明治', short: 'M', start: { y: 1868, m: 10, d: 23 } },
];

export const MIN_DATE: Ymd = { y: 1873, m: 1, d: 1 };

export type Wareki = {
  era: Era;
  year: number;
  /** 令和8年10月26日 */
  text: string;
  /** R8.10.26 */
  short: string;
  /** 令和08年10月26日（帳票向けのゼロ埋め） */
  padded: string;
};

const yearLabel = (n: number) => (n === 1 ? '元' : String(n));

function eraOf(date: Ymd): Era {
  if (compareYmd(date, MIN_DATE) < 0) throw new Error('明治6年（1873年）1月1日より前は旧暦のため対応していません');
  return ERAS.find((e) => compareYmd(date, e.start) >= 0)!;
}

export function toWareki(date: Ymd): Wareki {
  if (!isValidYmd(date)) throw new Error('存在しない日付です');
  const era = eraOf(date);
  const year = date.y - era.start.y + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    era,
    year,
    text: `${era.name}${yearLabel(year)}年${date.m}月${date.d}日`,
    short: `${era.short}${year}.${date.m}.${date.d}`,
    padded: `${era.name}${pad(year)}年${pad(date.m)}月${pad(date.d)}日`,
  };
}

export type FromWareki = {
  date: Ymd;
  /** 元号の範囲外（平成31年5月1日など）の場合の注意 */
  warning?: string;
};

const ERA_ALIASES: Record<string, string> = {};
for (const e of ERAS) {
  ERA_ALIASES[e.name] = e.name;
  ERA_ALIASES[e.short] = e.name;
  ERA_ALIASES[e.short.toLowerCase()] = e.name;
  ERA_ALIASES[e.name.charAt(0)] = e.name; /** 「令8.10.26」のような1文字表記 */
}
ERA_ALIASES['㋿'] = '令和';
ERA_ALIASES['㍻'] = '平成';
ERA_ALIASES['㍼'] = '昭和';
ERA_ALIASES['㍽'] = '大正';
ERA_ALIASES['㍾'] = '明治';

/**
 * 和暦の文字列を西暦にする。
 * 「令和8年10月26日」「令和元年5月1日」「R8.10.26」「H31/4/30」「Ｓ６４．１．７」などに対応。
 */
export function parseWareki(input: string): FromWareki {
  const s = toHalfWidthDigits(input.trim())
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '');
  const m = /^(令和|平成|昭和|大正|明治|[㋿㍻㍼㍽㍾]|[RHSTMrhstm令平昭大明])(元|\d{1,4})(?:年|[./-])(\d{1,2})(?:月|[./-])(\d{1,2})日?$/.exec(s);
  if (!m) throw new Error('「令和8年10月26日」「R8.10.26」「H31/4/30」のような形式で入力してください');

  /** 4つの組は正規表現で必ず一致する（既定値は型のためだけ） */
  const [, eraText = '', yearText = '', monthText = '', dayText = ''] = m;
  const era = ERAS.find((e) => e.name === ERA_ALIASES[eraText])!;
  const year = yearText === '元' ? 1 : Number(yearText);
  if (year < 1) throw new Error('年は1（元年）以上で入力してください');
  const date = { y: era.start.y + year - 1, m: Number(monthText), d: Number(dayText) };
  if (date.y > 9999) throw new Error('西暦9999年まで入力できます');
  if (!isValidYmd(date)) throw new Error('存在しない日付です');
  if (compareYmd(date, MIN_DATE) < 0) throw new Error('明治6年（1873年）1月1日より前は旧暦のため対応していません');

  const actual = toWareki(date);
  let warning: string | undefined;
  if (actual.era.name !== era.name) {
    warning = `${era.name}${yearLabel(year)}年${date.m}月${date.d}日は、正しくは${actual.text}です`;
  }
  return { date, warning };
}

/**
 * 西暦・和暦のどちらで書かれていても日付として読む。
 * 4桁の数字で始まれば西暦として解釈し、そのエラー（「存在しない日付です」など）をそのまま返す。
 */
export function parseDateAny(input: string): FromWareki {
  if (/^\s*[0-9０-９]{4}/.test(input)) return { date: parseYmd(input) };
  return parseWareki(input);
}

/** 西暦の年に対応する和暦（改元の年は「昭和64年 / 平成元年」のように2つ） */
export function erasOfYear(y: number): string[] {
  const ascending = [...ERAS].reverse();
  return ascending
    .filter((e, i) => {
      const next = ascending[i + 1];
      const startsByYearEnd = compareYmd(e.start, { y, m: 12, d: 31 }) <= 0;
      const endsAfterYearStart = !next || compareYmd(next.start, { y, m: 1, d: 1 }) > 0;
      return startsByYearEnd && endsAfterYearStart;
    })
    .map((e) => `${e.name}${yearLabel(y - e.start.y + 1)}年`);
}

const KAN = '甲乙丙丁戊己庚辛壬癸';
const SHI = '子丑寅卯辰巳午未申酉戌亥';
const ANIMALS = ['ねずみ', 'うし', 'とら', 'うさぎ', 'たつ', 'へび', 'うま', 'ひつじ', 'さる', 'とり', 'いぬ', 'いのしし'];

/** 干支（十干十二支） */
export function eto(y: number): { kanshi: string; animal: string } {
  const i = (((y - 4) % 60) + 60) % 60;
  return { kanshi: KAN.charAt(i % 10) + SHI.charAt(i % 12), animal: ANIMALS[i % 12] ?? '' };
}

/** 満年齢（誕生日に1歳増える一般的な数え方） */
export function ageOn(birth: Ymd, on: Ymd): number {
  let age = on.y - birth.y;
  if (on.m < birth.m || (on.m === birth.m && on.d < birth.d)) age--;
  return age;
}

/**
 * 生年月日（西暦・和暦のどちらでも）から、基準日（空なら today）の満年齢を求める。
 * 生年月日が基準日より後のときと、和暦にできない日付（1873年より前）はエラー（画面の描画中に例外を起こさないよう、ここで確かめる）。
 */
export function ageFrom(birthText: string, baseText: string, today: Ymd): { age: number; on: Ymd; birthText: string } {
  const birth = parseDateAny(birthText).date;
  const on = baseText.trim() ? parseDateAny(baseText).date : today;
  if (compareYmd(birth, on) > 0) throw new Error('生年月日が基準日より後になっています');
  return { age: ageOn(birth, on), on, birthText: toWareki(birth).text };
}

export type YearRow = { year: number; wareki: string; eto: string };

/** 早見表 */
export function yearTable(from: number, to: number): YearRow[] {
  const rows: YearRow[] = [];
  for (let y = from; y <= to; y++) {
    rows.push({ year: y, wareki: erasOfYear(y).join(' / '), eto: eto(y).kanshi });
  }
  return rows;
}
