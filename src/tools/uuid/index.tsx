import { useCallback, useEffect, useMemo, useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { usePreference } from '../../hooks/usePreference';
import { isBoolean, oneOf } from '../../lib/settings';
import { formatJstLabeled, showsMillis } from '../../lib/time/dateTimeFormat';
import { createSortableIdGenerators, inspectId, uuidV4 } from './logic';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';
import { Check } from '../../components/Check';

type Kind = 'v4' | 'v7' | 'ulid';
const COUNTS = [1, 5, 10, 50, 100];

const DESCRIPTIONS: Record<Kind, string> = {
  v4: '完全にランダムな UUID。最も広く使われる形式です。',
  v7: '先頭にミリ秒単位の時刻を含む UUID。生成順に並ぶため、DBの主キーにするとインデックスが断片化しにくくなります。',
  ulid: '時刻＋乱数の26文字。UUIDより短く、文字列のまま時刻順にソートできます。大文字小文字を区別しない英数字のみ。',
};

export default function UuidTool() {
  const [kind, setKind] = usePreference<Kind>('uuid:kind', 'v4', oneOf('v4', 'v7', 'ulid'));
  const [count, setCount] = usePreference('uuid:count', 5, oneOf(...COUNTS));
  const [upper, setUpper] = usePreference('uuid:upper', false, isBoolean);
  const [hyphen, setHyphen] = usePreference('uuid:hyphen', true, isBoolean);
  const [ids, setIds] = useState<string[]>([]);
  /** 生成をまたいでも生成順に並ぶよう、画面を開いている間は同じ生成器を使う */
  const [generators] = useState(() => createSortableIdGenerators());
  const [inspectInput, setInspectInput] = useState('');

  const generate = useCallback(() => {
    const now = Date.now();
    if (kind === 'v4') {
      setIds(Array.from({ length: count }, () => uuidV4()));
    } else {
      /** 同じミリ秒にまとめて生成しても、前回の生成より後に並ぶ */
      const gen = kind === 'ulid' ? generators.ulid : generators.v7;
      setIds(Array.from({ length: count }, () => gen(now)));
    }
  }, [kind, count, generators]);

  useEffect(generate, [generate]);

  const shown = useMemo(
    () =>
      ids.map((id) => {
        let s = id;
        if (kind !== 'ulid' && !hyphen) s = s.replace(/-/g, '');
        if (kind !== 'ulid') s = upper ? s.toUpperCase() : s.toLowerCase();
        return s;
      }),
    [ids, kind, upper, hyphen],
  );

  const inspection = useMemo(() => {
    if (!inspectInput.trim()) return null;
    return attempt(() => ({ info: inspectId(inspectInput) }));
  }, [inspectInput]);

  return (
    <ToolShell description="ブラウザの暗号論的乱数で生成します。">
      <div className="toolbar">
        <Segmented<Kind>
          label="種類"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'v4', label: 'UUID v4' },
            { value: 'v7', label: 'UUID v7' },
            { value: 'ulid', label: 'ULID' },
          ]}
        />
        <label>
          生成数
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {COUNTS.map((c) => (
              <option key={c} value={c}>
                {c}個
              </option>
            ))}
          </select>
        </label>
        {kind !== 'ulid' && (
          <>
            <Check label="大文字" checked={upper} onChange={setUpper} />
            <Check label="ハイフン" checked={hyphen} onChange={setHyphen} />
          </>
        )}
        <button type="button" className="btn btn-primary" onClick={generate}>
          ↻ 再生成
        </button>
        <CopyButton text={shown.join('\n')} label="すべてコピー" />
      </div>
      <p className="hint">{DESCRIPTIONS[kind]}</p>

      <ul className="id-list">
        {shown.map((id, i) => (
          <li key={`${i}-${id}`} className="value-item">
            <span className="value-text mono">{id}</span>
            <CopyButton text={id} />
          </li>
        ))}
      </ul>

      <h2 className="section-title">解析</h2>
      <input
        aria-label="解析する UUID または ULID"
        className="input mono"
        placeholder="UUID または ULID を貼り付けると、種類と埋め込まれた時刻を表示します"
        value={inspectInput}
        onChange={(e) => setInspectInput(e.target.value)}
        spellCheck={false}
      />
      {inspection && !inspection.ok && <ErrorText message={inspection.error} />}
      {inspection?.ok && (
        <table className="kv">
          <tbody>
            <tr>
              <th>種類</th>
              <td>{inspection.info.kind === 'ulid' ? 'ULID' : `UUID バージョン ${inspection.info.version}`}</td>
            </tr>
            {inspection.info.kind === 'uuid' && (
              <tr>
                <th>バリアント</th>
                <td>{inspection.info.variant}</td>
              </tr>
            )}
            <tr>
              <th>正規化</th>
              <td className="mono">{inspection.info.canonical}</td>
            </tr>
            <tr>
              <th>生成日時</th>
              <td className="mono">
                {inspection.info.timeStatus === 'decoded'
                  ? `${formatJstLabeled(new Date(inspection.info.time), showsMillis(new Date(inspection.info.time)))}（${inspection.info.time}）`
                  : inspection.info.timeStatus === 'absent' ? 'このバージョンは時刻を含みません' : 'この形式の時刻解析には未対応です'}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </ToolShell>
  );
}
