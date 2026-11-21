import { useEffect, useState } from 'react';
import { useCalculation } from '../../hooks/useCalculation';
import { CalculationStatus } from '../../components/CalculationStatus';
import { CopyButton } from '../../components/CopyButton';
import type { PackedRows } from './packed';

/** コピー用の全文を操作時に準備する。入力変更で非表示になったら、準備中のWorkerと全文を破棄する。 */
export function UnifiedOutput({ inputSize, rows, enabled }: { inputSize: number; rows: PackedRows; enabled: boolean }) {
  const [requested, setRequested] = useState<PackedRows | null>(null);
  const prepared = enabled && requested === rows;
  /** 前の入力の圧縮結果も保持し続けない。操作の非表示は描画時のpreparedで先に行う。 */
  useEffect(() => { setRequested(null); }, [rows, enabled]);
  return (
    <div className="stack">
      <button type="button" className="btn btn-ghost" disabled={!enabled} aria-expanded={prepared} onClick={() => setRequested(prepared ? null : rows)}>
        {prepared ? 'unified形式の出力を閉じる' : 'unified形式を準備'}
      </button>
      {prepared && <PreparedUnified inputSize={inputSize} rows={rows} />}
    </div>
  );
}

/** ブラウザのコピー権限を保つため、準備完了後の新しい操作でクリップボードへ書き込む。 */
function PreparedUnified({ inputSize, rows }: { inputSize: number; rows: PackedRows }) {
  const calculation = useCalculation({ tool: 'diffUnified', inputSize, rows });
  return (
    <div className="stack">
      <CalculationStatus {...calculation} />
      <CopyButton text={calculation.result ?? ''} label="unified形式でコピー" />
    </div>
  );
}
