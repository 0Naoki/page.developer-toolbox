import { CALCULATION_TIMEOUT, INPUT_TOO_LARGE, MAX_CALCULATION_INPUT, type CalculationState } from '../lib/worker/calculationLimits';
import { acceptResponse, calculationInputSize, type CalculationRequest, type CalculationResponse, type CalculationResults } from '../calculation/protocol';
import { createCalculationWorker } from '../calculation/createWorker';
import { useWorkerJob, type WorkerJobOptions } from './useWorkerJob';

const OPTIONS: WorkerJobOptions<CalculationRequest> = {
  create: createCalculationWorker,
  timeout: CALCULATION_TIMEOUT,
  timeoutAdvice: '入力を分割して再計算してください。',
  beforeStart: (request) => {
    if (calculationInputSize(request) > MAX_CALCULATION_INPUT) throw new Error(INPUT_TOO_LARGE);
  },
};

/**
 * 入力の変更が止まってから Worker で計算する。
 *
 * @remarks
 * 待機・打ち切り（`CALCULATION_TIMEOUT`）・古い要求の結果を返さないことは useWorkerJob が受け持つ。
 * ここでは入力の上限の確認と、要求と違うツールの結果を受け取らないこと（acceptResponse）を加える。
 *
 * @typeParam T - 対象ツールと入力の組。
 * @param request - 計算要求。描画のたびに作り直しても、中身が同じなら計算し直さない。
 * @returns 計算状態、結果、エラー、中断・再計算の操作。
 */
export function useCalculation<T extends CalculationRequest>(request: T) {
  const job = useWorkerJob<CalculationRequest, CalculationResponse>(request, OPTIONS);
  const response = job.state === 'done' ? acceptResponse(request, job.response) : job.state === 'failed' ? { ok: false as const, error: job.error } : null;
  const state: CalculationState = job.state === 'pending' ? 'pending' : job.state === 'cancelled' ? 'cancelled' : response?.ok ? 'done' : 'error';
  return {
    state,
    /** 計算中（結果を待っている）。結果を使う操作（入れ替え・コピーなど）は、この間は無効にする */
    busy: state === 'pending',
    result: response?.ok ? response.result as CalculationResults[T['tool']] : null,
    error: response && !response.ok ? response.error : null,
    cancel: job.cancel,
    restart: job.restart,
  };
}
