import { useMemo } from 'react';
import { Pane } from '../../components/Pane';
import { Notice } from '../../components/Notice';
import { useInput } from '../../hooks/useInput';
import { addDuration, difference, parseDuration } from './logic';
import { parseAny } from './epoch';
import { ViewTable, ZoneSelect, zoneRows, type ZoneProps } from './parts';
import { showsMillis } from '../../lib/time/dateTimeFormat';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';

/** 日時の差と、期間の足し引きのパネル */
export function Calc({ now, zones, inputZone, inputZones, setZone }: ZoneProps) {
  const [fromText, setFromText] = useInput('time:diff-from');
  const [toText, setToText] = useInput('time:diff-to');
  const [baseText, setBaseText] = useInput('time:base');
  const [durationText, setDurationText] = useInput('time:duration');

  const diff = useMemo(() => {
    if (!fromText.trim() || !toText.trim()) return null;
    return attempt(() => ({ d: difference(parseAny(fromText, inputZone, now), parseAny(toText, inputZone, now)) }));
  }, [fromText, toText, inputZone, now]);

  const added = useMemo(() => {
    if (!baseText.trim() || !durationText.trim()) return null;
    return attempt(() => addDuration(parseAny(baseText, inputZone, now), parseDuration(durationText), inputZone));
  }, [baseText, durationText, inputZone, now]);

  const round = (n: number) => String(Math.round(n * 1000) / 1000);

  return (
    <>
      <div className="toolbar">
        <ZoneSelect value={inputZone} zones={inputZones} onChange={setZone} label="入力のタイムゾーン" />
        <span className="muted">日時のほか、エポック時間や「now」も入力できます</span>
      </div>
      <div className="split">
        <Pane title="2つの日時の差">
          <label className="field">
            <span className="field-label">開始</span>
            <input className="input mono" placeholder="2026-04-01 09:00" value={fromText} onChange={(e) => setFromText(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">終了</span>
            <input className="input mono" placeholder="now" value={toText} onChange={(e) => setToText(e.target.value)} />
          </label>
          {diff && !diff.ok && <ErrorText message={diff.error} />}
          {diff?.ok && (
            <ViewTable
              rows={[
                ['差', diff.d.text],
                ['日', round(diff.d.totalDays)],
                ['時間', round(diff.d.totalHours)],
                ['分', round(diff.d.totalMinutes)],
                ['秒', round(diff.d.totalSeconds)],
              ]}
            />
          )}
        </Pane>

        <Pane title="期間を足し引き">
          <label className="field">
            <span className="field-label">基準の日時</span>
            <input className="input mono" placeholder="now" value={baseText} onChange={(e) => setBaseText(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">期間（+1d 2h、-90分、1年2ヶ月 など）</span>
            <input className="input mono" placeholder="+1d 2h 30m" value={durationText} onChange={(e) => setDurationText(e.target.value)} />
          </label>
          {added && !added.ok && <ErrorText message={added.error} />}
          {added?.ok && (
            <>
              {added.clamped && <Notice tone="warn">足した月にその日がないため、月末にそろえました</Notice>}
              <ViewTable
                rows={[
                  ...zoneRows(added.date, zones, showsMillis(added.date)),
                  ['秒', String(Math.floor(added.date.getTime() / 1000))],
                  ['ISO8601', added.date.toISOString()],
                ]}
              />
            </>
          )}
          <p className="hint">年・月・日は {inputZone} の暦で足すため、夏時間をまたいでも同じ時刻になります。時間・分・秒は経過時間で足します。</p>
        </Pane>
      </div>
    </>
  );
}
