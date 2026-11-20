import { useEffect, useMemo, useRef } from 'react';
import { Notice } from '../../components/Notice';
import { KvRow } from '../../components/KvRow';
import { ToolShell } from '../../components/ToolShell';
import { useInput } from '../../hooks/useInput';
import { WEEKDAYS_JA, dayOfWeek, formatYmd, parseYmd } from '../../lib/time/date';
import { useTodayJst } from '../../hooks/useTodayJst';
import { ageFrom, eto, parseWareki, toWareki, yearTable } from './logic';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';

/** 入力が空なら null、そうでなければ計算した結果（失敗したときはエラーの文言） */
const attemptInput = <T extends object>(input: string, run: (s: string) => T) => (input.trim() ? attempt(() => run(input)) : null);

export default function WarekiTool() {
  const today = useTodayJst();
  const todayText = formatYmd(today);
  const [seireki, setSeireki] = useInput('wareki:seireki', todayText);
  const [wareki, setWareki] = useInput('wareki');
  const [birth, setBirth] = useInput('wareki:birth');
  const [baseDate, setBaseDate] = useInput('wareki:base');

  const toW = useMemo(() => attemptInput(seireki, (s) => {
    const date = parseYmd(s);
    return { date, w: toWareki(date) };
  }), [seireki]);
  const toS = useMemo(() => attemptInput(wareki, parseWareki), [wareki]);
  const age = useMemo(
    () => attemptInput(birth, (s) => ageFrom(s, baseDate, today)),
    /** today は描画のたびに作り直されるため、日付の文字列で変化を判断する（日付が変わったら計算し直す） */
    [birth, baseDate, todayText],
  );

  const rows = useMemo(() => yearTable(1926, today.y + 10).reverse(), [today.y]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const currentRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    /** ページ全体ではなく、表の中だけを今年の行までスクロールする */
    const wrap = wrapRef.current;
    const row = currentRow.current;
    if (wrap && row) wrap.scrollTop = row.offsetTop - wrap.clientHeight / 2;
  }, []);

  return (
    <ToolShell
      description="改元日（平成→令和は2019年5月1日、昭和→平成は1989年1月8日）を考慮して変換します。明治6年（1873年）以降に対応。"
    >
      <div className="cards-2">
        <section className="panel">
          <h2 className="panel-title">西暦 → 和暦</h2>
          <div className="input-row">
            <input
              className="input mono"
              value={seireki}
              onChange={(e) => setSeireki(e.target.value)}
              placeholder="2026-10-26"
              aria-label="西暦の日付"
            />
            <button type="button" className="btn btn-ghost" onClick={() => setSeireki(formatYmd(today))}>
              今日
            </button>
          </div>
          {toW && !toW.ok && <ErrorText message={toW.error} />}
          {toW?.ok && (
            <table className="kv">
              <tbody>
                <KvRow label="和暦" value={toW.w.text} />
                <KvRow label="略記" value={toW.w.short} />
                <KvRow label="ゼロ埋め" value={toW.w.padded} />
                <KvRow label="曜日・干支" value={`${WEEKDAYS_JA[dayOfWeek(toW.date)]}曜日 ／ ${eto(toW.date.y).kanshi}（${eto(toW.date.y).animal}）`} copy={false} mono={false} />
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">和暦 → 西暦</h2>
          <input
            className="input mono"
            value={wareki}
            onChange={(e) => setWareki(e.target.value)}
            placeholder="令和8年10月26日 / R8.10.26 / H31/4/30"
            aria-label="和暦の日付"
          />
          {toS && !toS.ok && <ErrorText message={toS.error} />}
          {toS?.ok && (
            <>
              {toS.warning && <Notice tone="warn" message={toS.warning} />}
              <table className="kv">
                <tbody>
                  <KvRow label="西暦" value={formatYmd(toS.date)} />
                  <KvRow label="スラッシュ" value={formatYmd(toS.date, '/')} />
                  <KvRow label="8桁" value={formatYmd(toS.date, '')} />
                  <KvRow label="曜日" value={`${WEEKDAYS_JA[dayOfWeek(toS.date)]}曜日`} copy={false} mono={false} />
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">年齢</h2>
          <label className="field">
            <span className="field-label">生年月日（西暦・和暦どちらでも）</span>
            <input className="input mono" value={birth} onChange={(e) => setBirth(e.target.value)} placeholder="1993-04-01 / H5.4.1" />
          </label>
          <label className="field">
            <span className="field-label">基準日（空欄なら今日）</span>
            <input className="input mono" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} placeholder={formatYmd(today)} />
          </label>
          {age && !age.ok && <ErrorText message={age.error} />}
          {age?.ok && (
            <p className="big-result">
              満 <strong>{age.age}</strong> 歳
              <span className="muted">（{age.birthText}生まれ）</span>
            </p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">早見表</h2>
          <div className="year-table-wrap" ref={wrapRef}>
            <table className="year-table">
              <thead>
                <tr>
                  <th>西暦</th>
                  <th>和暦</th>
                  <th>干支</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.year} ref={r.year === today.y ? currentRow : undefined} className={r.year === today.y ? 'current' : undefined}>
                    <td className="mono">{r.year}</td>
                    <td>{r.wareki}</td>
                    <td>{r.eto}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ToolShell>
  );
}
