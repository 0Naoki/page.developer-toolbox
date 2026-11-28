import { WEEKDAYS_JA, dayOfWeek, formatYmd, type Ymd } from '../../lib/time/date';

export const withDow = (d: Ymd) => `${formatYmd(d, '/')}（${WEEKDAYS_JA[dayOfWeek(d)]}）`;

/** 年の選択（選択肢は numericInput.ts の yearChoices） */
export function YearSelect({ value, years, onChange }: { value: number; years: readonly number[]; onChange: (year: number) => void }) {
  return (
    <label>
      年
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}年
          </option>
        ))}
      </select>
    </label>
  );
}

export function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="2026-10-26" />
    </label>
  );
}
