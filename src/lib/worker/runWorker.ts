/** Worker の要求の待機・起動・打ち切り・終了と、失敗の文言。画面からは useWorkerJob を通して使う。 */
import { errorMessage } from '../errors';

export type WorkerFailure = 'start' | 'runtime' | 'message' | 'timeout';

type WorkerJob<Request, Response> = {
  request: Request;
  create: () => Worker;
  delay: number;
  timeout: number;
  beforeStart?: () => void;
  onResult: (response: Response) => void;
  onError: (reason: WorkerFailure, error?: unknown) => void;
};

/**
 * 待機・起動・打ち切り・終了を一つの要求として管理する。
 *
 * @remarks
 * 終了後の応答は無視し、成功・失敗の通知は一度だけ行う。
 * 生成関数は呼び出し側が指定し、Trusted Typesのポリシーは変更しない。
 * @returns cancelは未完了の要求を止めた場合だけtrueを返す。通知は行わない。
 */
export function runWorker<Request, Response>(job: WorkerJob<Request, Response>) {
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  const cancel = (): boolean => {
    if (finished) return false;
    finished = true;
    clearTimeout(timer);
    clearTimeout(timeout);
    worker?.terminate();
    return true;
  };
  const fail = (reason: WorkerFailure, error?: unknown) => {
    if (cancel()) job.onError(reason, error);
  };
  timer = setTimeout(() => {
    try {
      job.beforeStart?.();
      worker = job.create();
      worker.onmessage = (event: MessageEvent<Response>) => {
        if (cancel()) job.onResult(event.data);
      };
      worker.onerror = () => fail('runtime');
      worker.onmessageerror = () => fail('message');
      timeout = setTimeout(() => fail('timeout'), job.timeout);
      worker.postMessage(job.request);
    } catch (error) {
      fail('start', error);
    }
  }, job.delay);
  return { cancel };
}

/**
 * Worker の失敗を、画面に表示する文言にする（大容量計算と正規表現で文言をそろえる）。
 *
 * @param options.timeout - 打ち切りまでのミリ秒（文言には秒で書く）。
 * @param options.timeoutAdvice - 打ち切ったときに続ける、利用者への案内（「入力を分割して再計算してください。」など）。
 * @returns 開始前の確認（beforeStart）で投げた例外は、その文言をそのまま返す（上限超過の理由などを伝えるため）。
 */
export function workerFailureMessage(reason: WorkerFailure, error: unknown, options: { timeout: number; timeoutAdvice: string }): string {
  switch (reason) {
    case 'timeout': return `計算を${options.timeout / 1000}秒で打ち切りました。${options.timeoutAdvice}`;
    case 'message': return '計算結果を受け取れませんでした。入力を短くして再計算してください。';
    case 'runtime': return '計算を開始できません。画面を再読み込みしてください。';
    case 'start': return errorMessage(error, '計算を開始できませんでした。');
  }
}
