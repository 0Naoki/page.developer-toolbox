import { useMemo } from 'react';
import { usePreference } from '../../hooks/usePreference';
import { integerBetween } from '../../lib/settings';
import { compareYmd, formatYmd, type Ymd } from '../../lib/time/date';
import { HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR, holidaysOfYear } from './holidays';
import { withDow } from './tabFields';
import { attempt } from '../../lib/errors';
import { ErrorText } from '../../components/ErrorMessage';

export function HolidaysTab({ today }: { today: Ymd }) {
  const currentYear = Math.min(HOLIDAY_MAX_YEAR, Math.max(HOLIDAY_MIN_YEAR, today.y));
  const minYear = Math.max(HOLIDAY_MIN_YEAR, currentYear - 10);
  const maxYear = Math.min(HOLIDAY_MAX_YEAR, currentYear + 10);
  const isYear = integerBetween(minYear, maxYear);
  const [savedYear, setYear] = usePreference('bizdays:hyear', currentYear, isYear);
  const year = isYear(savedYear) ? savedYear : currentYear;
  const list = useMemo(() => attempt(() => ({ holidays: holidaysOfYear(year) })), [year]);
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);

  return (
    <>
      <div className="toolbar">
        <label>
          年
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </label>
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
