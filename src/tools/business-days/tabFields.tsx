import { WEEKDAYS_JA, dayOfWeek, formatYmd, type Ymd } from '../../lib/time/date';

export const withDow = (d: Ymd) => `${formatYmd(d, '/')}（${WEEKDAYS_JA[dayOfWeek(d)]}）`;

export function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="2026-10-26" />
    </label>
  );
}
