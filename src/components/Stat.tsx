import type { ReactNode } from 'react';

/** 数値を大きく見せるタイル */
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value mono">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}
