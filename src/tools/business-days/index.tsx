/**
 * 営業日計算のファイルの分担。この画面はタブと、タブ間で共有する暦の設定（週末・祝日・独自休日）を担当する。
 * - `logic.ts`：営業日の判定・数え上げと期間の集計
 * - `holidays.ts`：日本の祝日の計算
 * - `numericInput.ts`：用途ごとの整数入力と範囲の検証
 * - `RangeTab.tsx`・`AddTab.tsx`・`MonthTab.tsx`・`HolidaysTab.tsx`：各タブの画面（`tabFields.tsx` はタブで共通の入力欄）
 */
import { LargeTextInput } from '../../components/LargeTextInput';
import { useMemo } from 'react';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { arrayOf, integerBetween, isBoolean, oneOf } from '../../lib/settings';
import { WEEKDAYS_JA } from '../../lib/time/date';
import { useTodayJst } from '../../hooks/useTodayJst';
import { HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR } from './holidays';
import { DEFAULT_CALENDAR, invalidHolidaysMessage, parseExtraHolidays, type Calendar } from './logic';
import { RangeTab } from './RangeTab';
import { AddTab } from './AddTab';
import { MonthTab } from './MonthTab';
import { HolidaysTab } from './HolidaysTab';
import { ErrorText } from '../../components/ErrorMessage';
import { Check } from '../../components/Check';

type Tab = 'range' | 'add' | 'month' | 'holidays';

export default function BusinessDays() {
  const today = useTodayJst();
  const [tab, setTab] = usePreference<Tab>('bizdays:tab', 'range', oneOf('range', 'add', 'month', 'holidays'));
  const [weekend, setWeekend] = usePreference<number[]>('bizdays:weekend', DEFAULT_CALENDAR.weekend, arrayOf(integerBetween(0, 6), 7));
  const [useHolidays, setUseHolidays] = usePreference('bizdays:holidays', true, isBoolean);
  const [yearEnd, setYearEnd] = usePreference('bizdays:yearEnd', false, isBoolean);
  /** 会社独自の休日は利用者が貼り付ける業務データなので、表示設定ではなく入力内容として保存設定に従わせる */
  const [extraText, setExtraText] = useInput('bizdays:extra');

  const extra = useMemo(() => parseExtraHolidays(extraText), [extraText]);
  /**
   * 読めない項目だけを編集したときは、読めた日付が同じなら同じ配列を使う（暦・期間の結果・全件コピーの関数を作り直さず、
   * コピー中の状態を捨てないように）。日付は「2026-10-26」の形にそろえてあるので、つないだ文字列で同じかを判断できる
   */
  const datesKey = extra.dates.join(',');
  const extraDates = useMemo(() => extra.dates, [datesKey]);
  const cal: Calendar = useMemo(
    () => ({ weekend, holidays: useHolidays, yearEnd, extra: extraDates }),
    [weekend, useHolidays, yearEnd, extraDates],
  );

  const toggleWeekday = (d: number) =>
    setWeekend(weekend.includes(d) ? weekend.filter((x) => x !== d) : [...weekend, d].sort());

  return (
    <ToolShell
      description={`日本の祝日（振替休日・国民の休日を含む）を考慮して計算します。祝日は${HOLIDAY_MIN_YEAR}〜${HOLIDAY_MAX_YEAR}年に対応。`}
    >
      <div className="biz-layout">
        <aside className="settings-panel">
          <div className="field">
            <span className="field-label">休みにする曜日</span>
            <div className="weekday-row">
              {WEEKDAYS_JA.map((w, i) => (
                <label key={w} className={weekend.includes(i) ? 'day-toggle on' : 'day-toggle'}>
                  <input type="checkbox" checked={weekend.includes(i)} onChange={() => toggleWeekday(i)} />
                  {w}
                </label>
              ))}
            </div>
          </div>
          <Check label="祝日・休日を休みにする" checked={useHolidays} onChange={setUseHolidays} />
          <Check label="年末年始（12/29〜1/3）を休みにする" checked={yearEnd} onChange={setYearEnd} />
          {/** 入力欄の上に「元に戻す」などのボタンが並ぶため、label ではなく div で囲む（見出しのクリックでボタンが押されないように） */}
          <div className="field">
            <span className="field-label">会社独自の休日（1行に1日付）</span>
            {/** 長い一覧を普通の textarea で描画すると画面が止まるため、表示を先頭までにする */}
            <LargeTextInput label="会社独自の休日（1行に1日付）" className="code code-short" value={extraText} onChange={setExtraText} placeholder={'2026-08-13\n2026-08-14'} />
            {/** 読めない項目が大量・長大でも表示が重くならないよう、解析側で件数と1件の長さを制限した抜粋だけを示す */}
            {extra.invalidCount > 0 && (
              <ErrorText
                as="span"
                message={invalidHolidaysMessage(extra)}
              />
            )}
          </div>
        </aside>

        <div className="biz-main stack">
          <Segmented<Tab>
            label="計算の種類"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'range', label: '期間の営業日数' },
              { value: 'add', label: 'n営業日後' },
              { value: 'month', label: '月ごとの営業日' },
              { value: 'holidays', label: '祝日一覧' },
            ]}
          />
          <div className="stack">
            {tab === 'range' && <RangeTab cal={cal} today={today} />}
            {tab === 'add' && <AddTab cal={cal} today={today} />}
            {tab === 'month' && <MonthTab cal={cal} today={today} />}
            {tab === 'holidays' && <HolidaysTab today={today} />}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
