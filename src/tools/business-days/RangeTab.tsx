import { useCallback, useMemo, useRef } from 'react';
import { Stat } from '../../components/Stat';
import { useInput } from '../../hooks/useInput';
import { daysInMonth, formatYmd, parseYmd, type Ymd } from '../../lib/time/date';
import { summarizeBusinessRange, type Calendar } from './logic';
import { DateInput, withDow } from './tabFields';
import { attempt } from '../../lib/errors';
import { ErrorText } from '../../components/ErrorMessage';
import { ListRest } from '../../components/ListRest';
import { previewList } from '../../lib/listPreview';

type OffDay = { date: Ymd; reason: string };

const sameOffDay = (a: OffDay, b: OffDay) => a.reason === b.reason && a.date.y === b.date.y && a.date.m === b.date.m && a.date.d === b.date.d;

/**
 * 内容が前の描画と同じ一覧なら、前の配列をそのまま返す。
 *
 * @remarks
 * 期間の外の独自休日を足すなど、暦が変わっても休みの一覧が同じことがある。全件コピーの関数を内容が変わったときだけ作り直し、
 * コピー中の状態を捨てないようにする（CopyButton は関数が変わると、コピー中の状態を前の内容のものとして捨てる）。
 * 比べるのは日付と理由だけで、全件の文字列は作らない
 */
function useSameList(list: readonly OffDay[] | null): readonly OffDay[] | null {
  const ref = useRef(list);
  const prev = ref.current;
  const same = list === prev || (list !== null && prev !== null && list.length === prev.length && list.every((x, i) => sameOffDay(x, prev[i]!)));
  if (!same) ref.current = list;
  return ref.current;
}

export function RangeTab({ cal, today }: { cal: Calendar; today: Ymd }) {
  const [from, setFrom] = useInput('bizdays:from', formatYmd({ ...today, d: 1 }));
  const [to, setTo] = useInput('bizdays:to', formatYmd({ ...today, d: daysInMonth(today.y, today.m) }));

  const r = useMemo(
    () => attempt(() => summarizeBusinessRange(parseYmd(from), parseYmd(to), cal)),
    [from, to, cal],
  );
  /** 件数は期間（最大30年）と独自休日の数で増える（毎日を独自休日にすると1万件を超える）ため、先頭だけを描画し、全件はコピーで取り出す */
  const offDays = r.ok ? previewList(r.offDays) : null;
  /** 休みの一覧の内容が変わらない間は同じ関数を渡す（暦が変わっても一覧が同じなら、コピー中の状態を捨てない） */
  const sameOffDays = useSameList(r.ok ? r.offDays : null);
  const copyOffDays = useCallback(() => (sameOffDays ?? []).map((o) => `${withDow(o.date)}\t${o.reason}`).join('\n'), [sameOffDays]);

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
