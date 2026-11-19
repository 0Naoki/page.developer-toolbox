import { useState } from 'react';
import { useCalculation } from '../../hooks/useCalculation';
import { CalculationStatus } from '../../components/CalculationStatus';
import { CopyButton } from '../../components/CopyButton';
import { downloadText } from '../../lib/file';
import type { DiagnosticKind } from './reports';

/** 全件取得を選ぶまで準備せず、入力が変わった描画から旧結果の操作を表示しない。 */
export function DiagnosticOutput({ input, kind, label }: { input: string; kind: DiagnosticKind; label: string }) {
  const [requestedInput, setRequestedInput] = useState<string | null>(null);
  const prepared = requestedInput === input;
  return (
    <div className="stack">
      <button type="button" className="btn btn-ghost" aria-expanded={prepared} onClick={() => setRequestedInput(prepared ? null : input)}>
        {prepared ? `${label}の出力を閉じる` : `${label}の全件を準備`}
      </button>
      {prepared && <PreparedDiagnostic input={input} kind={kind} label={label} />}
    </div>
  );
}

/** 準備とコピーを分け、ブラウザの操作権限を使うコピー・保存は新しい操作で行う。 */
function PreparedDiagnostic({ input, kind, label }: { input: string; kind: DiagnosticKind; label: string }) {
  const calculation = useCalculation({ tool: 'countReport', input, kind });
  const output = calculation.result ?? '';
  return (
    <div className="stack">
      <CalculationStatus {...calculation} />
      <div className="toolbar">
        <CopyButton text={output} label={`${label}の全件をコピー`} />
        <button type="button" className="btn btn-ghost" disabled={!output} onClick={() => downloadText(`diagnostic-${kind}.tsv`, output, 'text/tab-separated-values')}>{label}の全件を保存</button>
      </div>
    </div>
  );
}
