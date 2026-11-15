/**
 * UNIX時間変換のファイルの分担。
 * - `epoch.ts`：エポック時間の解析と一括変換
 * - `logic.ts`：期間の計算と、表示用の値の組み立て
 * - `Convert.tsx`・`Calc.tsx`・`Bulk.tsx`：相互変換・期間計算・一括変換のパネル
 * - `ZoneEditor.tsx`：表示するタイムゾーンの追加・削除。`parts.tsx` はパネルで共通の部品
 */
import { useMemo } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { usePreference } from '../../hooks/usePreference';
import { arrayOf, oneOf } from '../../lib/settings';
import { useNow } from '../../hooks/useNow';
import { toView } from './logic';
import { canonicalZone, isStoredZone, isValidZone, JST_ZONE, type Zone } from '../../lib/time/timezone';
import { Convert } from './Convert';
import { Calc } from './Calc';
import { Bulk } from './Bulk';
import { ZoneEditor } from './ZoneEditor';

type Tab = 'convert' | 'calc' | 'bulk';

/** 検証済みのタイムゾーン名を正式な表記にそろえ、重複を除く。 */
const validZones = (zones: readonly Zone[]): Zone[] =>
  [...new Set(zones.map(canonicalZone).filter((zone): zone is Zone => zone !== null))];

export default function UnixTime() {
  const now = useNow();
  const [tab, setTab] = usePreference<Tab>('time:tab', 'convert', oneOf('convert', 'calc', 'bulk'));
  const [storedZones, setZones] = usePreference<Zone[]>('time:zones', [JST_ZONE, 'UTC'], arrayOf(isStoredZone, 1000));
  const [zone, setZone] = usePreference<Zone>('time:zone', JST_ZONE, isStoredZone);
  const zones = useMemo(() => {
    const list = validZones(storedZones);
    return list.length > 0 ? list : [JST_ZONE];
  }, [storedZones]);
  /** 入力のタイムゾーンは、一覧から外しても選べるように残す */
  const inputZone = isValidZone(zone) ? zone : JST_ZONE;
  const inputZones = zones.includes(inputZone) ? zones : [inputZone, ...zones];

  const current = toView(new Date(now), now);

  return (
    <ToolShell
      description="桁数で単位を判定します（13桁以上はミリ秒、16桁以上はマイクロ秒、19桁以上はナノ秒）。タイムゾーンは IANA の名前（Asia/Tokyo など）で指定し、夏時間も考慮します。"
    >
      <div className="now-box">
        <span className="muted">現在</span>
        <span className="mono big">{current.epochSeconds}</span>
        <span className="mono">{current.jst} JST</span>
        <CopyButton text={String(current.epochSeconds)} label="秒をコピー" />
      </div>

      <div className="toolbar">
        <Segmented<Tab>
          label="機能"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'convert', label: '変換' },
            { value: 'calc', label: '差・足し引き' },
            { value: 'bulk', label: 'ログの一括変換' },
          ]}
        />
      </div>

      {tab === 'convert' && <Convert now={now} zones={zones} inputZone={inputZone} inputZones={inputZones} setZone={setZone} />}
      {tab === 'calc' && <Calc now={now} zones={zones} inputZone={inputZone} inputZones={inputZones} setZone={setZone} />}
      {tab === 'bulk' && <Bulk zones={zones} />}

      <ZoneEditor zones={zones} setZones={setZones} />
    </ToolShell>
  );
}


