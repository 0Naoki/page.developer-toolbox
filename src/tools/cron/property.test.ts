/**
 * cron式のプロパティテスト（fast-check で入力を生成し、どの入力でも成り立つ性質を確かめる）。
 * 個別の入力の期待値は logic.test.ts にある。失敗したときは、表示された seed と path を fc.assert の引数に足すと同じ入力で再現できる。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayOfWeek } from '../../lib/time/date';
import { wallOf, type Zone } from '../../lib/time/timezone';
import { buildCron, type CronSpec } from './build';
import { nextRuns } from './nextRuns';
import { SPECS, fieldOf, parseCron, type Dialect, type FieldName } from './parse';

const DIALECTS: Dialect[] = ['unix', 'kubernetes', 'quartz', 'aws'];
/** 夏時間のないゾーン・1時間ずれるゾーン・30分ずれるゾーン */
const ZONES: Zone[] = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Australia/Lord_Howe'];
/** 基準日時：1970年〜2100年 */
const fromArb = fc.integer({ min: 0, max: Date.UTC(2100, 0, 1) });

const specArb: fc.Arbitrary<CronSpec> = fc.record({
  frequency: fc.constantFrom('minutes', 'hourly', 'daily', 'weekly', 'monthly'),
  interval: fc.integer({ min: 1, max: 59 }),
  minute: fc.integer({ min: 0, max: 59 }),
  hour: fc.integer({ min: 0, max: 23 }),
  weekdays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
  day: fc.integer({ min: 1, max: 31 }),
});

describe('buildCron → parseCron → nextRuns', () => {
  it('組み立てた式はどの形式でも読め、次回の実行日時は基準より後で早い順に並び、選んだ頻度と時刻に一致する', () => {
    fc.assert(
      fc.property(specArb, fc.constantFrom(...DIALECTS), fc.constantFrom(...ZONES), fromArb, (spec, dialect, zone, from) => {
        const built = buildCron(spec, dialect);
        if (!built.ok) throw new Error(built.error);
        const runs = nextRuns(parseCron(built.expression, dialect), zone, from, 3);
        expect(runs).toHaveLength(3);
        runs.forEach((run, i) => expect(run).toBeGreaterThan(i === 0 ? from : runs[i - 1]!));
        for (const run of runs) {
          const w = wallOf(run, zone);
          expect(w.s).toBe(0);
          if (spec.frequency === 'minutes') expect(w.mi % spec.interval).toBe(0);
          else expect(w.mi).toBe(spec.minute);
          if (spec.frequency === 'daily' || spec.frequency === 'weekly' || spec.frequency === 'monthly') expect(w.h).toBe(spec.hour);
          if (spec.frequency === 'weekly') expect(spec.weekdays).toContain(dayOfWeek({ y: w.y, m: w.mo, d: w.d }));
          if (spec.frequency === 'monthly') expect(w.d).toBe(spec.day);
        }
      }),
    );
  });
});

/** 標準の cron の1項目の書き方（*・数・範囲・間隔・カンマ区切り）と、読めない書き方 */
function fieldArb(min: number, max: number): fc.Arbitrary<string> {
  const value = fc.integer({ min, max });
  const step = fc.integer({ min: 1, max: max - min + 1 });
  const item = fc.oneof(
    fc.constant('*'),
    step.map((s) => `*/${s}`),
    value.map(String),
    fc.tuple(value, value).map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`),
    fc.tuple(value, value, step).map(([a, b, s]) => `${Math.min(a, b)}-${Math.max(a, b)}/${s}`),
  );
  const broken = fc.oneof(fc.integer({ min: -5, max: max + 5 }).map(String), fc.constantFrom('', '*/0', '1-', '-1', '1/2/3', 'X', 'L', '?'));
  return fc.oneof({ weight: 9, arbitrary: fc.array(item, { minLength: 1, maxLength: 4 }).map((items) => items.join(',')) }, { weight: 1, arbitrary: broken });
}

const UNIX_FIELDS: { name: FieldName; min: number; max: number }[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'weekday', min: 0, max: 7 },
];

describe('parseCron（標準の cron）', () => {
  it('読めない式は Error で拒否し、読めた式の値は範囲内で重複なく小さい順に並ぶ', () => {
    const expressionArb = fc.tuple(...UNIX_FIELDS.map(({ min, max }) => fieldArb(min, max))).map((fields) => fields.join(' '));
    fc.assert(
      fc.property(expressionArb, (expression) => {
        let cron;
        try {
          cron = parseCron(expression, 'unix');
        } catch (e) {
          /** 画面に理由を出せるよう、読めない式は TypeError・RangeError ではなく、文言付きの Error にする */
          expect(e).toBeInstanceOf(Error);
          expect((e as Error).constructor).toBe(Error);
          expect((e as Error).message).not.toBe('');
          return;
        }
        for (const { name } of UNIX_FIELDS) {
          const values = fieldOf(cron.fields, name)!.values;
          const [low, high] = name === 'weekday' ? [0, 6] : [SPECS[name].min, SPECS[name].max];
          expect(values.length).toBeGreaterThan(0);
          expect(values.every((v) => Number.isInteger(v) && v >= low && v <= high)).toBe(true);
          expect(values.every((v, i) => i === 0 || values[i - 1]! < v)).toBe(true);
        }
      }),
    );
  });

  it('次回の実行日時は、基準より後で早い順に並び、分・時・月が式の値に一致する', () => {
    const expressionArb = fc.tuple(...UNIX_FIELDS.map(({ min, max }) => fieldArb(min, max))).map((fields) => fields.join(' '));
    fc.assert(
      fc.property(expressionArb, fc.constantFrom(...ZONES), fromArb, (expression, zone, from) => {
        let cron;
        try {
          cron = parseCron(expression, 'unix');
        } catch {
          return;
        }
        const runs = nextRuns(cron, zone, from, 3);
        runs.forEach((run, i) => expect(run).toBeGreaterThan(i === 0 ? from : runs[i - 1]!));
        for (const run of runs) {
          const w = wallOf(run, zone);
          expect(fieldOf(cron.fields, 'minute')!.values).toContain(w.mi);
          expect(fieldOf(cron.fields, 'hour')!.values).toContain(w.h);
          expect(fieldOf(cron.fields, 'month')!.values).toContain(w.mo);
        }
      }),
      { numRuns: 50 },
    );
  });
});
