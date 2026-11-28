import { useMemo } from 'react';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { WEEKDAYS_JA, dayOfWeek, type Ymd } from '../../lib/time/date';
import { nthBusinessDayOfMonth, yearSummary, type Calendar } from './logic';
import { attempt } from '../../lib/errors';
import { ErrorText } from '../../components/ErrorMessage';
import { parseMonthOrdinal, yearChoices } from './numericInput';
import { YearSelect } from './tabFields';

export function MonthTab({ cal, today }: { cal: Calendar; today: Ymd }) {
  const { current, years, isYear } = yearChoices(today.y);
  const [savedYear, setYear] = usePreference('bizdays:year', current, isYear);
  const year = isYear(savedYear) ? savedYear : current;
  const [nthText, setNthText] = useInput('bizdays:nth', '5');
  const ordinal = useMemo(() => attempt(() => ({ value: parseMonthOrdinal(nthText) })), [nthText]);
  const nth = ordinal.ok ? ordinal.value : null;

  const r = useMemo(
    () =>
      attempt(() => ({
        months: yearSummary(year, cal).map((s) => ({ ...s, nth: nth === null ? null : nthBusinessDayOfMonth(year, s.month, nth, cal) })),
      })),
    [year, cal, nth],
  );

  const short = (d: Ymd | null) => (d ? `${d.m}/${d.d}（${WEEKDAYS_JA[dayOfWeek(d)]}）` : '—');

  return (
    <>
      <div className="toolbar">
        <YearSelect value={year} years={years} onChange={setYear} />
        <label>
          第
          <input className="input input-num mono" inputMode="numeric" value={nthText} onChange={(e) => setNthText(e.target.value)} />
          営業日も表示
        </label>
      </div>
      {!r.ok && <ErrorText message={r.error} />}
      {!ordinal.ok && <ErrorText message={ordinal.error} />}
      {r.ok && (
        <table className="data-table">
          <thead>
            <tr>
              <th>月</th>
              <th className="right">営業日数</th>
              <th>第1営業日</th>
              {nth !== null && <th>第{nth}営業日</th>}
              <th>最終営業日</th>
            </tr>
          </thead>
          <tbody>
            {r.months.map((m) => (
              <tr key={m.month} className={year === today.y && m.month === today.m ? 'current' : undefined}>
                <td>{m.month}月</td>
                <td className="right mono">{m.business}</td>
                <td className="mono">{short(m.first)}</td>
                {nth !== null && <td className="mono">{short(m.nth)}</td>}
                <td className="mono">{short(m.last)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>合計</td>
              <td className="right mono">{r.months.reduce((s, m) => s + m.business, 0)}</td>
              <td colSpan={nth !== null ? 3 : 2} />
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}
