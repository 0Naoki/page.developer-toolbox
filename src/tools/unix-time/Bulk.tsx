import { useMemo, useState } from 'react';
import { Pane } from '../../components/Pane';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { Badge } from '../../components/Badge';
import { CalculationStatus } from '../../components/CalculationStatus';
import { CopyButton } from '../../components/CopyButton';
import { TextOutputPreview } from '../../components/FormattedOutput';
import { LargeTextInput } from '../../components/LargeTextInput';
import { Segmented } from '../../components/Segmented';
import { useCalculation } from '../../hooks/useCalculation';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { type BulkMode } from './epoch';
import { isStoredZone, JST_ZONE, type Zone } from '../../lib/time/timezone';
import { formatNumber } from '../../lib/number';

/** サンプルのログ（秒・ミリ秒・マイクロ秒の時刻と、変換しない ID を含む、架空の値） */
const SAMPLE = [
  '1790899200 INFO 起動しました',
  '1790899201234 WARN 応答が遅い（request_id=1790899201234567890abc）',
  '{"ts": 1790899205123456, "level": "error", "msg": "接続を切断"}',
].join('\n');

/** ログの一括変換のパネル */
export function Bulk({ zones }: { zones: Zone[] }) {
  const [text, setText] = useInput('time:bulk');
  /** サンプルで入力を差し替えたとき、編集履歴を作り直す（LargeTextInput の resetKey） */
  const [inputRevision, setInputRevision] = useState(0);
  const [outZone, setOutZone] = usePreference<Zone>('time:bulk-zone', JST_ZONE, isStoredZone);
  const [mode, setMode] = usePreference<BulkMode>('time:bulk-mode', 'append', oneOf('append', 'replace'));
  const zone = zones.includes(outZone) ? outZone : zones[0] ?? JST_ZONE;

  /** 大きなログでも画面が固まらないよう、Worker で変換する */
  const request = useMemo(() => ({ tool: 'epoch' as const, input: text, zone, mode }), [text, zone, mode]);
  const calculation = useCalculation(request);
  const result = calculation.result;
  const output = result?.output ?? '';

  return (
    <>
      <div className="toolbar">
        <select value={zone} onChange={(e) => setOutZone(e.target.value)} aria-label="変換先のタイムゾーン">
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}で表示
            </option>
          ))}
        </select>
        <Segmented<BulkMode>
          label="書き方"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'append', label: '後ろに付け足す' },
            { value: 'replace', label: '置き換える' },
          ]}
        />
        <button type="button" className="btn btn-ghost" onClick={() => {
          setText(SAMPLE);
          setInputRevision((revision) => revision + 1);
        }}>
          サンプル
        </button>
        {text && result && <Badge>{formatNumber(result.count)} 個を変換</Badge>}
      </div>
      <CalculationStatus {...calculation} />
      <p className="hint">10桁（秒）・13桁（ミリ秒）・16桁（マイクロ秒）・19桁（ナノ秒）の数値を変換します。前後が英数字につながっている数値（ID など）は変換しません。</p>
      <div className="split">
        <Pane title="ログ">
          <LargeTextInput limit={MAX_CALCULATION_INPUT} label="ログ" value={text} onChange={setText} resetKey={inputRevision} placeholder={'1700000000 INFO started\n1700000123456 WARN slow query'} />
        </Pane>
        <Pane title="変換結果" actions={<CopyButton text={output} />}>
          <TextOutputPreview label="変換結果" text={output} />
        </Pane>
      </div>
    </>
  );
}
