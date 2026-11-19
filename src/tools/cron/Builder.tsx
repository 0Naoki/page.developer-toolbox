import { useState } from 'react';
import { Check } from '../../components/Check';
import { ErrorText } from '../../components/ErrorMessage';
import { Segmented } from '../../components/Segmented';
import { WEEKDAYS_JA } from '../../lib/time/date';
import { buildCron, type Frequency } from './build';
import type { Dialect } from './parse';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'minutes', label: '何分ごと' },
  { value: 'hourly', label: '毎時' },
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly', label: '毎月' },
];

/** 入力欄の文字列を整数として読む。空欄は範囲外として扱う（buildCron がエラーにする） */
const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

/**
 * cron式の組み立て。頻度と時刻を選び、今の形式（dialect）の書き方の式を作って、式の欄に入れる。
 * 組み立ての途中の値は保存しない（式の欄に入れた式だけを、ほかの入力と同じく保存する）。
 */
export function Builder({ dialect, onUse }: { dialect: Dialect; onUse: (expression: string) => void }) {
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [interval, setInterval] = useState('5');
  const [minute, setMinute] = useState('0');
  const [hour, setHour] = useState('9');
  const [day, setDay] = useState('1');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const result = buildCron(
    { frequency, interval: toNumber(interval), minute: toNumber(minute), hour: toNumber(hour), weekdays, day: toNumber(day) },
    dialect,
  );
  const numberField = (label: string, value: string, setValue: (v: string) => void, min: number, max: number) => (
    <label>
      {label}
      <input type="number" className="input input-num mono" min={min} max={max} step={1} value={value} onChange={(e) => setValue(e.target.value)} />
    </label>
  );

  return (
    <details className="panel">
      <summary>式を組み立てる</summary>
      <div className="toolbar">
        <Segmented<Frequency> label="頻度" value={frequency} onChange={setFrequency} options={FREQUENCIES} />
      </div>
      <div className="toolbar">
        {frequency === 'minutes' && numberField('何分ごと', interval, setInterval, 1, 59)}
        {frequency === 'monthly' && numberField('日', day, setDay, 1, 31)}
        {(frequency === 'daily' || frequency === 'weekly' || frequency === 'monthly') && numberField('時', hour, setHour, 0, 23)}
        {frequency !== 'minutes' && numberField('分', minute, setMinute, 0, 59)}
      </div>
      {frequency === 'weekly' && (
        <div className="toolbar" role="group" aria-label="曜日">
          {WEEKDAYS_JA.map((name, d) => (
            <Check
              key={name}
              label={name}
              checked={weekdays.includes(d)}
              onChange={(checked) => setWeekdays(checked ? [...weekdays, d] : weekdays.filter((w) => w !== d))}
            />
          ))}
        </div>
      )}
      {frequency === 'monthly' && toNumber(day) > 28 && (
        <p className="hint">その日がない月（2月の30日など）は実行しません。</p>
      )}
      {result.ok ? (
        <div className="toolbar">
          <code className="mono" aria-label="組み立てた式">{result.expression}</code>
          <button type="button" className="btn btn-primary" onClick={() => onUse(result.expression)}>この式を入れる</button>
        </div>
      ) : (
        <ErrorText message={result.error} />
      )}
    </details>
  );
}
