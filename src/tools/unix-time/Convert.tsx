/** エポック時間と日時の相互変換のパネル */
import { useMemo } from 'react';
import { Pane } from '../../components/Pane';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { toView } from './logic';
import { isSubSecondEpoch, parseEpoch, type EpochUnit } from './epoch';
import { parseDateTime } from '../../lib/time/dateTimeInput';
import { hasWrittenFraction, showsMillis } from '../../lib/time/dateTimeFormat';
import { ViewTable, ZoneSelect, zoneRows, type ZoneProps } from './parts';
import { ErrorText } from '../../components/ErrorMessage';
import { Notice } from '../../components/Notice';
import { attempt } from '../../lib/errors';

const UNIT_LABELS: Record<EpochUnit, string> = { s: '秒', ms: 'ミリ秒', us: 'マイクロ秒', ns: 'ナノ秒' };
const isEpochUnitSetting = oneOf<EpochUnit | 'auto'>('auto', 's', 'ms', 'us', 'ns');

export function Convert({ now, zones, inputZone, inputZones, setZone }: ZoneProps) {
  const [epochInput, setEpochInput] = useInput('time:epoch');
  const [dateInput, setDateInput] = useInput('time:date');
  /**
   * 単位は入力の意味を変えるため、入力と一緒に残す（パネルの移動や再読み込みで「自動」に戻ると、同じ数値が別の時刻になる）。
   * 入力内容ではないので、表示設定として保存する
   */
  const [unit, setUnit] = usePreference<EpochUnit | 'auto'>('time:unit', 'auto', isEpochUnitSetting);

  const parsedEpoch = useMemo(() => {
    if (!epochInput.trim()) return null;
    return attempt(() => parseEpoch(epochInput, unit));
  }, [epochInput, unit]);

  const parsedDate = useMemo(() => {
    if (!dateInput.trim()) return null;
    return attempt(() => ({ date: parseDateTime(dateInput, inputZone) }));
  }, [dateInput, inputZone]);

  /** 入力の解析は編集時だけ行い、毎秒の更新では相対時間を含む表示だけを作り直す。 */
  const fromEpoch = useMemo(() => parsedEpoch?.ok
    ? attempt(() => ({ date: parsedEpoch.date, unit: parsedEpoch.unit, alternative: parsedEpoch.alternative, view: toView(parsedEpoch.date, now) }))
    : parsedEpoch, [parsedEpoch, now]);
  const fromDate = useMemo(() => parsedDate?.ok
    ? attempt(() => ({ date: parsedDate.date, view: toView(parsedDate.date, now) }))
    : parsedDate, [parsedDate, now]);

  return (
    <div className="split">
      <Pane title="エポック → 日時" actions={
        <select aria-label="エポック入力の単位" value={unit} onChange={(e) => setUnit(e.target.value as EpochUnit | 'auto')}>
          <option value="auto">自動（桁数で判定）</option>
          {Object.entries(UNIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      }>
        <input
          aria-label="エポック時間（秒・ミリ秒・マイクロ秒・ナノ秒）"
          className="input mono"
          inputMode="numeric"
          placeholder="1790899200"
          value={epochInput}
          onChange={(e) => setEpochInput(e.target.value)}
        />
        {fromEpoch && !fromEpoch.ok && <ErrorText message={fromEpoch.error} />}
        {fromEpoch?.ok && (
          <ViewTable
            rows={[
              ['解釈', UNIT_LABELS[fromEpoch.unit]],
              ...zoneRows(fromEpoch.date, zones, showsMillis(fromEpoch.date, isSubSecondEpoch(epochInput, fromEpoch.unit))),
              ['ISO8601', fromEpoch.view.iso],
              ['相対', fromEpoch.view.relative],
            ]}
          />
        )}
        {/** 桁数だけでは単位を決めきれない（1973〜2001年のミリ秒は12桁で、秒として読むと西暦2万年台になる） */}
        {fromEpoch?.ok && fromEpoch.alternative && (
          <Notice tone="warn">
            桁数から{UNIT_LABELS[fromEpoch.unit]}として読みました。{UNIT_LABELS[fromEpoch.alternative]}の値なら、単位を選んでください。
            <button type="button" className="link-btn" onClick={() => setUnit(fromEpoch.alternative ?? 'auto')}>
              {UNIT_LABELS[fromEpoch.alternative]}として読む
            </button>
          </Notice>
        )}
      </Pane>

      <Pane title="日時 → エポック" actions={<ZoneSelect value={inputZone} zones={inputZones} onChange={setZone} label="入力のタイムゾーン" />}>
        <input
          aria-label="日時"
          className="input mono"
          placeholder="2026-10-02 09:00:00"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
        />
        {fromDate && !fromDate.ok && <ErrorText message={fromDate.error} />}
        {fromDate?.ok && (
          <ViewTable
            rows={[
              ['秒', String(fromDate.view.epochSeconds)],
              ['ミリ秒', String(fromDate.view.epochMillis)],
              ['ISO8601', fromDate.view.iso],
              ...zoneRows(fromDate.date, zones, showsMillis(fromDate.date, hasWrittenFraction(dateInput))),
              ['相対', fromDate.view.relative],
            ]}
          />
        )}
      </Pane>
    </div>
  );
}
