import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorker, workerFailureMessage } from './runWorker';

/** 遅れて届くイベントも手動で送れるWorker。 */
function setup() {
  vi.useFakeTimers();
  const worker = {
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  const create = vi.fn(() => worker as unknown as Worker);
  const onResult = vi.fn();
  const onError = vi.fn();
  const options = { request: 'input', create, delay: 150, timeout: 2000, onResult, onError };
  return { worker, options, job: runWorker<string, string>(options) };
}

afterEach(() => vi.useRealTimers());

describe('Worker要求のライフサイクル', () => {
  it('待機中の中断ではWorkerを作らず、終了を通知しない', () => {
    const { job, options } = setup();
    expect(job.cancel()).toBe(true);
    vi.runAllTimers();
    expect(options.create).not.toHaveBeenCalled();
    expect(options.onResult).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('成功後の遅い応答・エラー・タイムアウトを無視する', () => {
    const { worker, options, job } = setup();
    vi.advanceTimersByTime(150);
    expect(worker.postMessage).toHaveBeenCalledWith('input');
    worker.onmessage?.({ data: 'first' } as MessageEvent<string>);
    worker.onmessage?.({ data: 'stale' } as MessageEvent<string>);
    worker.onerror?.();
    vi.runAllTimers();
    expect(options.onResult).toHaveBeenCalledExactlyOnceWith('first');
    expect(options.onError).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(job.cancel()).toBe(false);
  });

  it('実行中の中断後に届く応答を破棄する', () => {
    const { worker, options, job } = setup();
    vi.advanceTimersByTime(150);
    job.cancel();
    worker.onmessage?.({ data: 'stale' } as MessageEvent<string>);
    vi.runAllTimers();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(options.onResult).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('制限時間はWorker起動後から数え、打ち切りを一度だけ通知する', () => {
    const { worker, options } = setup();
    vi.advanceTimersByTime(2149);
    expect(options.onError).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    worker.onmessage?.({ data: 'late' } as MessageEvent<string>);
    expect(options.onError).toHaveBeenCalledExactlyOnceWith('timeout', undefined);
    expect(options.onResult).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('結果の転送エラーでもWorkerを終了する', () => {
    const { worker, options } = setup();
    vi.advanceTimersByTime(150);
    worker.onmessageerror?.();
    vi.runAllTimers();
    expect(options.onError).toHaveBeenCalledExactlyOnceWith('message', undefined);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('入力の事前検証に失敗した場合はWorkerを作らない', () => {
    const { job, options } = setup();
    job.cancel();
    const error = new Error('上限');
    runWorker({ ...options, beforeStart: () => { throw error; } });
    vi.runAllTimers();
    expect(options.create).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledExactlyOnceWith('start', error);
  });

  it('postMessageが失敗しても生成済みのWorkerとタイマーを残さない', () => {
    const { worker, options } = setup();
    const error = new Error('転送失敗');
    worker.postMessage.mockImplementation(() => { throw error; });
    vi.runAllTimers();
    expect(options.onError).toHaveBeenCalledExactlyOnceWith('start', error);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('Workerの実行エラーは通知後に終了し、遅い成功で上書きしない', () => {
    const { worker, options } = setup();
    vi.advanceTimersByTime(150);
    worker.onerror?.();
    worker.onmessage?.({ data: 'late' } as MessageEvent<string>);
    vi.runAllTimers();
    expect(options.onError).toHaveBeenCalledExactlyOnceWith('runtime', undefined);
    expect(options.onResult).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('Workerの失敗の文言', () => {
  const options = { timeout: 2000, timeoutAdvice: '入力を短くしてください。' };

  it('打ち切りは秒数と案内を、転送・実行の失敗は再計算・再読み込みを伝える', () => {
    expect(workerFailureMessage('timeout', undefined, options)).toBe('計算を2秒で打ち切りました。入力を短くしてください。');
    expect(workerFailureMessage('timeout', undefined, { ...options, timeout: 10_000 })).toBe('計算を10秒で打ち切りました。入力を短くしてください。');
    expect(workerFailureMessage('message', undefined, options)).toBe('計算結果を受け取れませんでした。入力を短くして再計算してください。');
    expect(workerFailureMessage('runtime', undefined, options)).toBe('計算を開始できません。画面を再読み込みしてください。');
  });

  it('開始前の確認で断った理由はそのまま伝え、Error 以外の例外は中身を表示しない', () => {
    expect(workerFailureMessage('start', new Error('置換文字列は10万文字までです'), options)).toBe('置換文字列は10万文字までです');
    expect(workerFailureMessage('start', { secret: '入力' }, options)).toBe('計算を開始できませんでした。');
  });
});
