import { useMemo, useState } from 'react';
import { availableZones, canonicalZone, type Zone } from '../../lib/time/timezone';
import { ErrorText } from '../../components/ErrorMessage';
import { detailPreview } from '../../lib/text/textPreview';
import { isImeComposing } from '../../lib/keyboard';

/** 表示するタイムゾーンの追加・削除 */

export function ZoneEditor({ zones, setZones }: { zones: Zone[]; setZones: (z: Zone[]) => void }) {
  const [draft, setDraft] = useState('');
  const all = useMemo(availableZones, []);
  /** 「asia/tokyo」も受け付けるため、正式な表記（Asia/Tokyo）にそろえてから重複を確かめる */
  /** canonicalZone が null なら存在しない名前なので、isValidZone で試し直さない（打つたびに例外を2回作らないように） */
  const canonical = canonicalZone(draft);
  const name = canonical ?? draft.trim();
  const error = name && canonical === null ? `タイムゾーン「${detailPreview(name)}」が見つかりません（例：America/New_York）` : '';
  const add = () => {
    if (!name || error) return;
    if (!zones.includes(name)) setZones([...zones, name]);
    setDraft('');
  };

  return (
    <section className="stack">
      <h2 className="section-title">表示するタイムゾーン</h2>
      <div className="tag-list">
        {zones.map((z) => (
          <span key={z} className="tag">
            <span className="mono">{z}</span>
            <button type="button" className="link-btn" aria-label={`${z} を外す`} disabled={zones.length === 1} onClick={() => setZones(zones.filter((x) => x !== z))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="input-row zone-add">
        <input
          aria-label="追加するタイムゾーン"
          className="input mono"
          list="time-zone-names"
          placeholder="America/New_York"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            /** 日本語入力の変換を確定する Enter では追加しない */
            if (e.key === 'Enter' && !isImeComposing(e)) add();
          }}
        />
        <button type="button" className="btn" onClick={add} disabled={!name || !!error}>
          追加
        </button>
      </div>
      <datalist id="time-zone-names">
        {all.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {error && <ErrorText message={error} />}
    </section>
  );
}
