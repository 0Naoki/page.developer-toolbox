import type { CalculationState } from '../lib/worker/calculationLimits';
import { ErrorText } from './ErrorMessage';

const STATUS_LABELS: Record<CalculationState, string> = {
  pending: '計算中…',
  cancelled: '計算を中断しました',
  error: '計算できません',
  done: '計算が完了しました',
};

export function CalculationStatus({ state, error, cancel, restart }: {
  state: CalculationState; error: string | null; cancel: () => void; restart: () => void;
}) {
  return (
    <div className="toolbar" data-calculation-state={state}>
      <span role="status">{STATUS_LABELS[state]}</span>
      {state === 'pending' && <button type="button" className="btn btn-ghost" onClick={cancel}>中断</button>}
      {(state === 'cancelled' || state === 'error') && <button type="button" className="btn btn-ghost" onClick={restart}>再計算</button>}
      {error && <ErrorText as="span" alert message={error} />}
    </div>
  );
}
