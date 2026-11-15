import { useEffect, useRef, useState } from 'react';
import { runWorker, workerFailureMessage } from '../lib/worker/runWorker';
import { useSameData } from './useSameData';
import { useLatest } from './useLatest';

/** 入力の変更が止まってから Worker を起動するまでの待ち時間（入力のたびに Worker を作り直さないため） */
const INPUT_SETTLE_MS = 150;

/**
 * 今の要求に対する Worker の計算の状態。
 * `pending` は計算中（または要求が null）、`failed` は打ち切り・起動の失敗・開始前の確認での拒否。
 */
export type WorkerOutcome<Response> =
  | { state: 'pending' }
  | { state: 'cancelled' }
  | { state: 'done'; response: Response }
  | { state: 'failed'; error: string };

export type WorkerJobOptions<Request> = {
  /** Worker を起動する（createTrustedWorker を使う関数） */
  create: () => Worker;
  /** 打ち切りまでのミリ秒 */
  timeout: number;
  /** 打ち切ったときの文言に続ける、利用者への案内 */
  timeoutAdvice: string;
  /** Worker を起動する前の確認（入力の上限など）。例外の文言をそのまま失敗の理由にする */
  beforeStart?: (request: Request) => void;
};

const PENDING: WorkerOutcome<never> = { state: 'pending' };

/**
 * 要求を Worker で計算し、今の要求に対する結果だけを返す（大容量計算の useCalculation と正規表現で共通）。
 *
 * @remarks
 * 入力の変更が止まってから起動し、`timeout` で打ち切る。要求が変わったとき・画面を離れたときは Worker を終了し、
 * 結果は要求と組にして持つため、入力を変えた直後の描画でも古い要求の結果を返さない。
 * 失敗の文言は {@link workerFailureMessage} でそろえる。
 *
 * - request は Worker へ送る普通のデータなので、作り直されても中身が同じ（useSameData）なら計算し直さない。null なら計算しない
 * - options は描画ごとに作り直してよい（要求を始めたときの値を使う）
 *
 * @returns 計算の状態と、中断（cancel）・同じ要求での再計算（restart）の操作。
 */
export function useWorkerJob<Request, Response>(requested: Request | null, options: WorkerJobOptions<Request>) {
  const request = useSameData(requested);
  const [evaluation, setEvaluation] = useState<{ request: Request; outcome: WorkerOutcome<Response> } | null>(null);
  const [retry, setRetry] = useState(0);
  const optionsRef = useLatest(options);
  /** 中断の操作は、描画を増やさないよう ref で持つ */
  const running = useRef<{ request: Request; cancel: () => boolean } | null>(null);
  useEffect(() => {
    if (request === null) return;
    const { create, timeout, timeoutAdvice, beforeStart } = optionsRef.current;
    const job = runWorker<Request, Response>({
      request, create, delay: INPUT_SETTLE_MS, timeout,
      beforeStart: beforeStart && (() => beforeStart(request)),
      onResult: (response) => setEvaluation({ request, outcome: { state: 'done', response } }),
      onError: (reason, error) => setEvaluation({ request, outcome: { state: 'failed', error: workerFailureMessage(reason, error, { timeout, timeoutAdvice }) } }),
    });
    running.current = { request, cancel: job.cancel };
    return () => { job.cancel(); };
  }, [request, retry]);
  const outcome = request !== null && evaluation?.request === request ? evaluation.outcome : PENDING;
  return {
    ...outcome,
    /** 計算中の要求を止める。止めたときだけ `cancelled` にする（完了した結果は残す） */
    cancel: () => {
      const job = running.current;
      if (job && job.cancel()) setEvaluation({ request: job.request, outcome: { state: 'cancelled' } });
    },
    restart: () => {
      setEvaluation(null);
      setRetry((value) => value + 1);
    },
  };
}
