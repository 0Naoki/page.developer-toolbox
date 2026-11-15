import { afterEach, describe, expect, it, vi } from 'vitest';
import { withStorageLock } from './lock';

/**
 * Firefox と同じく、コールバックから投げられた例外を「捕まえていない例外」として記録するロック。
 * 例外は、返す Promise の reject にもする
 */
function stubLocks() {
  const reported: unknown[] = [];
  const request = async <T>(_name: string, callback: () => T): Promise<T> => {
    try {
      return callback();
    } catch (error) {
      reported.push(error);
      throw error;
    }
  };
  vi.stubGlobal('navigator', { locks: { request } });
  return reported;
}

describe('withStorageLock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ロックの中の処理の結果を返す', async () => {
    stubLocks();
    await expect(withStorageLock(() => 42, () => 0)).resolves.toBe(42);
  });

  it('ロックの中の例外は、ロックの外で投げ直し、ロックのコールバックからは投げない', async () => {
    const reported = stubLocks();
    const quota = new DOMException('容量超過', 'QuotaExceededError');
    await expect(withStorageLock(() => { throw quota; }, () => 0)).rejects.toBe(quota);
    expect(reported).toEqual([]);
  });

  it('ロックが使えなければ、代わりの処理を実行する', async () => {
    vi.stubGlobal('navigator', {});
    await expect(withStorageLock(() => 1, () => 2)).resolves.toBe(2);
  });
});
