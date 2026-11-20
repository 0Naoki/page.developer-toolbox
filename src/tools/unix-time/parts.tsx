/** UNIX時間の各パネルで共通の部品（タイムゾーンの選択・結果の表） */
import { KvRow } from '../../components/KvRow';
import { type Zone } from '../../lib/time/timezone';
import { formatWithOffset } from '../../lib/time/dateTimeFormat';

export type ZoneProps = { now: number; zones: Zone[]; inputZone: Zone; inputZones: Zone[]; setZone: (z: Zone) => void };

export function ZoneSelect({ value, zones, onChange, label }: { value: Zone; zones: Zone[]; onChange: (z: Zone) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z}として解釈
        </option>
      ))}
    </select>
  );
}

export function ViewTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="kv kv-wrap">
      <tbody>
        {rows.map(([k, v]) => (
          <KvRow key={k} label={k} value={v} />
        ))}
      </tbody>
    </table>
  );
}

/** 時刻を、表示するタイムゾーンごとの行にする */
export const zoneRows = (date: Date, zones: Zone[], withMillis: boolean): [string, string][] => zones.map((z) => [z, formatWithOffset(date, z, withMillis)]);
