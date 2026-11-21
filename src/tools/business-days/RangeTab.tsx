import { useCallback, useMemo } from 'react';
import { Stat } from '../../components/Stat';
import { useInput } from '../../hooks/useInput';
import { daysInMonth, formatYmd, parseYmd, type Ymd } from '../../lib/time/date';
import { summarizeBusinessRange, type Calendar } from './logic';
import { DateInput, withDow } from './tabFields';
import { attempt } from '../../lib/errors';
import { ErrorText } from '../../components/ErrorMessage';
import { ListRest } from '../../components/ListRest';
import { previewList } from '../../lib/listPreview';

export function RangeTab({ cal, today }: { cal: Calendar; today: Ymd }) {
  const [from, setFrom] = useInput('bizdays:from', formatYmd({ ...today, d: 1 }));
  const [to, setTo] = useInput('bizdays:to', formatYmd({ ...today, d: daysInMonth(today.y, today.m) }));

  const r = useMemo(
    () => attempt(() => summarizeBusinessRange(parseYmd(from), parseYmd(to), cal)),
    [from, to, cal],
  );
  /** 件数は期間（最大30年）と独自休日の数で増える（毎日を独自休日にすると1万件を超える）ため、先頭だけを描画し、全件はコピーで取り出す */
  const offDays = r.ok ? previewList(r.offDays) : null;
  /** 結果が変わらない間は同じ関数を渡す（CopyButton は関数が変わると、コピー中の状態を前の内容のものとして捨てるため） */
  const copyOffDays = useCallback(() => (r.ok ? r.offDays.map((o) => `${withDow(o.date)}\t${o.reason}`).join('\n') : ''), [r]);

  return (
    <>
      <div className="input-grid">
        <DateInput label="開始日" value={from} onChange={setFrom} />
        <DateInput label="終了日" value={to} onChange={setTo} />
      </div>
      {!r.ok && <ErrorText message={r.error} />}
      {r.ok && (
        <>
          <div className="stats">
            <Stat label="営業日数" value={r.business} note="開始日・終了日を含む" />
            <Stat label="暦日数" value={r.calendar} />
            <Stat label="休日数" value={r.calendar - r.business} />
          </div>
          {offDays && r.offDays.length > 0 && (
            <>
              <h3 className="sub-title">期間内の平日以外の休み</h3>
              <ul className="holiday-list">
                {offDays.shown.map((o) => (
                  <li key={formatYmd(o.date)}>
                    <span className="mono">{withDow(o.date)}</span>
                    <span>{o.reason}</span>
                  </li>
                ))}
              </ul>
              <ListRest
                rest={offDays.rest}
                shown={offDays.shown.length}
                copyText={offDays.rest > 0 ? copyOffDays : undefined}
                copyLabel="すべての休みをコピー"
              />
            </>
          )}
        </>
      )}
    </>
  );
}
