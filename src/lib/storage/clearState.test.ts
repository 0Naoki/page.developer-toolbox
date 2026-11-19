import { expect, it, vi } from 'vitest';
import { createClearLifecycle } from './clearState';

it('消去開始から再読み込みまで保存を止め、起動時の失敗と再試行を後から購読できる', () => {
  const state = createClearLifecycle();
  expect(state.phase).toBe('ready');
  expect(state.blocked).toBe(false);
  state.begin();
  expect(state.phase).toBe('clearing');
  const retry = vi.fn();
  const failure = { ok: false as const, retry, sharedPending: false };
  state.finish(failure);
  const listener = vi.fn();
  const stop = state.subscribe(listener);
  expect(listener).toHaveBeenCalledWith(failure);
  expect(state.phase).toBe('failed');
  expect(state.blocked).toBe(true);
  failure.retry();
  expect(retry).toHaveBeenCalledOnce();
  state.finish({ ok: true });
  expect(state.phase).toBe('complete');
  expect(state.blocked).toBe(true);
  stop();
  state.finish(failure);
  expect(listener).toHaveBeenCalledTimes(2);
});
