import { useMemo } from 'react';
import { usePreference } from '../../hooks/usePreference';
import { compareYmd, formatYmd, type Ymd } from '../../lib/time/date';
import { HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR, holidaysOfYear } from './holidays';
import { withDow, YearSelect } from './tabFields';
import { yearChoices } from './numericInput';
import { attempt } from '../../lib/errors';
import { ErrorText } from '../../components/ErrorMessage';

export function HolidaysTab({ today }: { today: Ymd }) {
  const { current, years, isYear } = yearChoices(today.y, { min: HOLIDAY_MIN_YEAR, max: HOLIDAY_MAX_YEAR });
  const [savedYear, setYear] = usePreference('bizdays:hyear', current, isYear);
  const year = isYear(savedYear) ? savedYear : current;
  const list = useMemo(() => attempt(() => ({ holidays: holidaysOfYear(year) })), [year]);

  return (
    <>
      <div className="toolbar">
        <YearSelect value={year} years={years} onChange={setYear} />
      </div>
      {!list.ok && <ErrorText message={list.error} />}
      {list.ok && (
        <>
          <ul className="holiday-list">
            {list.holidays.map((h) => (
              <li key={formatYmd(h.date)} className={compareYmd(h.date, today) < 0 ? 'past' : undefined}>
                <span className="mono">{withDow(h.date)}</span>
                <span>{h.name}</span>
              </li>
            ))}
          </ul>
          <p className="hint">
            春分の日・秋分の日は計算による値です。正式な日付は前年2月の官報で公表されます。将来の法改正による変更は反映されません。
          </p>
        </>
      )}
    </>
  );
}
