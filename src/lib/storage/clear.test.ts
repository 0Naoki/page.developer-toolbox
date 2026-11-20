/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R009] 全消去の順序と遅れた通知：消去世代を記録してから削除すること。再試行で共有領域の削除や消去世代の更新を行わず、キーの列挙失敗や同じ内容の再保存があっても、消去後に別タブで保存された入力・設定を残すこと
 * - 戻る・進むのキャッシュ：キャッシュから戻ったタブも、離れていた間に消去世代が変わっていれば、タブ内データを消すこと
 * - [R010] 取りこぼした通知：起動から受け取りの登録までの間の全消去や、世代の記録の通知を取りこぼした場合も、世代のずれに気づいてタブ内データを消すこと
 * - 起動時の消去失敗：旧世代の入力を削除できない間は復元・保存を止め、通知登録後に失敗を示し、自分のタブだけを再試行すること
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_PREFIX } from './io';
import { INPUT_PREFIX } from './io';
import { memoryStorage } from './memory.fixtures';

/**
 * 保存データの全消去（clear.ts）のテスト。
 * 消去世代の記録・共有領域とタブ内の削除・タブ間通知・再試行の順序と、別タブの保存との競合を確かめる
 */
describe('保存データの全消去', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('起動時に旧世代の入力を削除できなければ復元と保存を止め、通知登録後に再試行できる', async () => {
    vi.resetModules();
    const input = `${INPUT_PREFIX}json`;
    const local = memoryStorage({ [`${APP_PREFIX}event:clear`]: 'after', [`${APP_PREFIX}pref:theme`]: '"dark"' });
    const session = memoryStorage({ [input]: 'old-input', [`${APP_PREFIX}event:tab-generation`]: 'before' });
    let fail = true;
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', { ...session, get length() { return session.length; }, removeItem: (key: string) => {
      if (fail && key === input) throw new DOMException('denied', 'SecurityError');
      session.removeItem(key);
    } });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('navigator', {});
    const { prepareStorage, readInput, saveInput, isClearingData, subscribeClearData } = await import('./index');
    prepareStorage(['json']);
    expect(isClearingData()).toBe(true);
    expect(readInput('json', '')).toBe('');
    expect(saveInput('json', 'new-input', '')).toBe(false);
    expect(session.getItem(input)).toBe('old-input');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    const result = listener.mock.calls[0]?.[0];
    expect(result).toMatchObject({ ok: false, sharedPending: false, retry: expect.any(Function) });
    fail = false;
    result.retry();
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ ok: true }));
    expect(session.getItem(input)).toBeNull();
    expect(local.dump()).toEqual({ [`${APP_PREFIX}event:clear`]: 'after', [`${APP_PREFIX}pref:theme`]: '"dark"' });
    unsubscribe();
  });

  it('ストレージが使えなくてもタブ間通知でタブ内データを消し、重複通知を無視する', async () => {
    vi.resetModules();
    const { subscribeClearData, isClearingData, saveInput } = await import('./index');
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'secret', other: 'keep' });
    let receive: ((event: { data: string }) => void) | null = null;
    const close = vi.fn();
    vi.stubGlobal('BroadcastChannel', class {
      close = close;
      set onmessage(callback: (event: { data: string }) => void) { receive = callback; }
    });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', { get length() { throw new Error('使用不可'); } });
    vi.stubGlobal('sessionStorage', session);
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    const emit = (data: string) => (receive as unknown as (event: { data: string }) => void)({ data });
    emit('other');
    expect(isClearingData()).toBe(false);
    emit('clear'); emit('clear');
    expect(session.dump()).toEqual({ other: 'keep' });
    expect(listener).toHaveBeenCalledTimes(1);
    /** 消去の後は、入力を書き戻さない */
    saveInput('json', 'after-clear', '');
    expect(session.dump()).toEqual({ other: 'keep' });
    unsubscribe();
    expect(close).toHaveBeenCalledTimes(1);
  });

  for (const key of [null, `${APP_PREFIX}event:clear`]) {
    it(`保存設定がなくても全消去通知（${key ?? 'clear()'}）でタブ内データを消す`, async () => {
      vi.resetModules();
      const { subscribeClearData } = await import('./index');
      const target = new EventTarget();
      const local = memoryStorage();
      const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'secret' });
      vi.stubGlobal('window', target);
      vi.stubGlobal('localStorage', local);
      vi.stubGlobal('sessionStorage', session);
      vi.stubGlobal('BroadcastChannel', undefined);
      const listener = vi.fn();
      const unsubscribe = subscribeClearData(listener);
      target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: key ? '1' : null, storageArea: local }));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(session.dump()).toEqual({});
      unsubscribe();
    });
  }

  it('回帰：戻る・進むのキャッシュから戻ったとき、離れていた間に消去世代が変わっていればタブ内データを消す', async () => {
    /** キャッシュにある間は storage イベントも BroadcastChannel も届かず、戻ったタブに消去前の入力が残っていた */
    vi.resetModules();
    const local = memoryStorage({ [`${APP_PREFIX}event:clear`]: 'before' });
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'secret' });
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('BroadcastChannel', undefined);
    const { subscribeClearData } = await import('./index');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    const pageshow = (persisted: boolean) => target.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));
    /** 世代が変わっていなければ何もしない */
    pageshow(true);
    expect(listener).not.toHaveBeenCalled();
    local.setItem(`${APP_PREFIX}event:clear`, 'after');
    /** キャッシュからでない表示（通常の読み込み）は、起動時の照合（prepareStorage）に任せる */
    pageshow(false);
    expect(listener).not.toHaveBeenCalled();
    pageshow(true);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ ok: true }));
    expect(session.dump()).toEqual({});
    /** 共有領域は消去を始めたタブだけが消す */
    expect(local.dump()).toEqual({ [`${APP_PREFIX}event:clear`]: 'after' });
    unsubscribe();
  });

  it('回帰：起動から受け取りの登録までの間に別タブで全消去されても、登録の直後にタブ内データを消す', async () => {
    /** 通知は登録前に届いて失われ、世代のずれで保存だけが黙って止まり続けていた（入力は消えず、再読み込みもされない） */
    vi.resetModules();
    const local = memoryStorage({ [`${APP_PREFIX}event:clear`]: 'before' });
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'secret' });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('BroadcastChannel', undefined);
    const { subscribeClearData } = await import('./index');
    /** 別タブの全消去（世代の記録）が、このタブの受け取りの登録より先に起きる */
    local.setItem(`${APP_PREFIX}event:clear`, 'after');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ ok: true }));
    expect(session.dump()).toEqual({});
    /** 共有領域は消去を始めたタブだけが消す */
    expect(local.dump()).toEqual({ [`${APP_PREFIX}event:clear`]: 'after' });
    unsubscribe();
  });

  it('回帰：世代の記録の通知を取りこぼしても、ほかのキーの storage イベントで世代のずれに気づいてタブ内データを消す', async () => {
    vi.resetModules();
    const local = memoryStorage({ [`${APP_PREFIX}event:clear`]: 'before' });
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'secret' });
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('BroadcastChannel', undefined);
    const { subscribeClearData } = await import('./index');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    const prefChanged = () => target.dispatchEvent(Object.assign(new Event('storage'), { key: `${APP_PREFIX}pref:theme`, newValue: '"dark"', storageArea: local }));
    /** 世代が変わっていなければ、ほかのキーの変更は全消去として扱わない */
    prefChanged();
    expect(listener).not.toHaveBeenCalled();
    local.setItem(`${APP_PREFIX}event:clear`, 'after');
    prefChanged();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ ok: true }));
    expect(session.dump()).toEqual({});
    unsubscribe();
  });

  it('通知を受けたタブは共有領域に触れず、消去後に別タブが保存した入力と設定を残す', async () => {
    vi.resetModules();
    const local = memoryStorage({ [`${APP_PREFIX}event:clear`]: 'before' });
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'old tab' });
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('BroadcastChannel', undefined);
    /** 消去前に開いていたタブ */
    const { subscribeClearData, isClearingData } = await import('./index');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    /** 別タブが消去し、その後に新しく開いたタブが保存した。このタブへの通知はそれより遅れて届く */
    local.setItem(`${APP_PREFIX}event:clear`, 'after');
    local.setItem(`${APP_PREFIX}pref:json:sortKeys`, 'true');
    local.setItem(`${INPUT_PREFIX}json`, 'new tab');
    expect(isClearingData()).toBe(true);
    target.dispatchEvent(Object.assign(new Event('storage'), { key: `${APP_PREFIX}event:clear`, newValue: 'after', storageArea: local }));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ ok: true }));
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({
      [`${APP_PREFIX}event:clear`]: 'after',
      [`${APP_PREFIX}pref:json:sortKeys`]: 'true',
      [`${INPUT_PREFIX}json`]: 'new tab',
    });
    unsubscribe();
  });

  it('通知を受けたタブの再試行は、自分のタブ内データだけを消し直し、別タブの新しい保存を残す', async () => {
    vi.resetModules();
    const local = memoryStorage({ [`${APP_PREFIX}event:clear`]: 'before' });
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'old tab' });
    let failRemoval = true;
    const remove = session.removeItem;
    session.removeItem = (key: string) => {
      if (failRemoval) throw new Error('削除不可');
      remove(key);
    };
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('BroadcastChannel', undefined);
    const { subscribeClearData } = await import('./index');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    local.setItem(`${APP_PREFIX}event:clear`, 'after');
    local.setItem(`${APP_PREFIX}pref:json:sortKeys`, 'true');
    local.setItem(`${INPUT_PREFIX}json`, 'new tab');
    target.dispatchEvent(Object.assign(new Event('storage'), { key: `${APP_PREFIX}event:clear`, newValue: 'after', storageArea: local }));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ ok: false, retry: expect.any(Function), sharedPending: false }));
    const retry = (listener.mock.calls[0]![0] as { retry: () => void }).retry;
    failRemoval = false;
    retry();
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith({ ok: true }));
    expect(session.dump()).toEqual({});
    expect(local.dump()).toEqual({
      [`${APP_PREFIX}event:clear`]: 'after',
      [`${APP_PREFIX}pref:json:sortKeys`]: 'true',
      [`${INPUT_PREFIX}json`]: 'new tab',
    });
    unsubscribe();
  });

  describe('消去を始めたタブの再試行は、失敗した処理だけをやり直し、消去後に別タブが保存した入力を残す', () => {
    const NEW_INPUT = `${INPUT_PREFIX}base64`;
    async function start(failing: { session?: boolean; localKey?: string; record?: boolean; list?: boolean }) {
      vi.resetModules();
      const local = memoryStorage({ [`${INPUT_PREFIX}json`]: 'secret', [`${APP_PREFIX}json:indent`]: '4' });
      const session = memoryStorage({ [`${INPUT_PREFIX}diff:before`]: 'secret' });
      const fail = { ...failing };
      const keyAt = local.key;
      local.key = (index: number) => {
        if (fail.list) throw new Error('列挙不可');
        return keyAt(index);
      };
      const removeLocal = local.removeItem;
      local.removeItem = (key: string) => {
        if (fail.localKey === key) throw new Error('削除不可');
        removeLocal(key);
      };
      const setLocal = local.setItem;
      local.setItem = (key: string, value: string) => {
        if (fail.record && key === `${APP_PREFIX}event:clear`) throw new Error('記録不可');
        setLocal(key, value);
      };
      const removeSession = session.removeItem;
      session.removeItem = (key: string) => {
        if (fail.session) throw new Error('削除不可');
        removeSession(key);
      };
      vi.stubGlobal('window', new EventTarget());
      vi.stubGlobal('localStorage', local);
      vi.stubGlobal('sessionStorage', session);
      vi.stubGlobal('BroadcastChannel', undefined);
      const { subscribeClearData, clearAllData } = await import('./index');
      const listener = vi.fn();
      const unsubscribe = subscribeClearData(listener);
      clearAllData();
      await vi.waitFor(() => expect(listener.mock.calls[0]?.[0]).toMatchObject({ ok: false, retry: expect.any(Function) }));
      /** 失敗を表示している間に、別タブ（消去後に開いたタブ）が新しい入力と設定を保存する */
      setLocal(NEW_INPUT, 'new tab');
      setLocal(`${APP_PREFIX}pref:base64:wrap`, 'true');
      const retry = (listener.mock.calls[0]![0] as { retry: () => void }).retry;
      return { local, session, fail, listener, retry, unsubscribe };
    }

    it('タブ内だけが失敗したときは、そのタブの sessionStorage だけを消し直す', async () => {
      const t = await start({ session: true });
      t.fail.session = false;
      t.retry();
      await vi.waitFor(() => expect(t.listener).toHaveBeenLastCalledWith({ ok: true }));
      expect(t.session.dump()).toEqual({});
      expect(t.local.getItem(NEW_INPUT)).toBe('new tab');
      expect(t.local.getItem(`${APP_PREFIX}pref:base64:wrap`)).toBe('true');
      t.unsubscribe();
    });

    it('共有領域で消せなかったキーは、同じ内容が再保存された場合も再試行で消さない', async () => {
      const t = await start({ localKey: `${INPUT_PREFIX}json` });
      t.local.setItem(`${INPUT_PREFIX}json`, 'secret');
      t.fail.localKey = undefined;
      t.retry();
      await vi.waitFor(() => expect(t.listener).toHaveBeenCalledTimes(2));
      expect(t.listener).toHaveBeenLastCalledWith({ ok: false, retry: expect.any(Function), sharedPending: true });
      expect(t.local.getItem(`${INPUT_PREFIX}json`)).toBe('secret');
      expect(t.local.getItem(NEW_INPUT)).toBe('new tab');
      t.unsubscribe();
    });

    it('初回に共有キーを列挙できなかった場合、再試行で新しいキーを消さない', async () => {
      const t = await start({ list: true });
      t.fail.list = false;
      t.retry();
      await vi.waitFor(() => expect(t.listener).toHaveBeenCalledTimes(2));
      expect(t.listener).toHaveBeenLastCalledWith({ ok: false, retry: expect.any(Function), sharedPending: true });
      expect(t.local.getItem(NEW_INPUT)).toBe('new tab');
      expect(t.local.getItem(`${APP_PREFIX}pref:base64:wrap`)).toBe('true');
      t.unsubscribe();
    });

    it('消去世代を記録できなかったときは、再試行で新しいタブに消去を通知しない', async () => {
      const t = await start({ record: true });
      expect(t.local.getItem(`${APP_PREFIX}event:clear`)).toBeNull();
      t.fail.record = false;
      t.retry();
      await vi.waitFor(() => expect(t.listener).toHaveBeenCalledTimes(2));
      expect(t.listener).toHaveBeenLastCalledWith({ ok: false, retry: expect.any(Function), sharedPending: true });
      expect(t.local.getItem(`${APP_PREFIX}event:clear`)).toBeNull();
      expect(t.local.getItem(NEW_INPUT)).toBe('new tab');
      t.unsubscribe();
    });
  });

  it('消去を始めたタブは、消去世代を記録してから共有領域とタブ内のデータを消す', async () => {
    vi.resetModules();
    const local = memoryStorage({ [`${INPUT_PREFIX}json`]: 'secret', [`${APP_PREFIX}json:indent`]: '4', other: 'keep' });
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'secret' });
    const recordedBeforeRemoval: boolean[] = [];
    const remove = local.removeItem;
    local.removeItem = (key: string) => {
      recordedBeforeRemoval.push(local.getItem(`${APP_PREFIX}event:clear`) !== null);
      remove(key);
    };
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('BroadcastChannel', undefined);
    const { subscribeClearData, clearAllData } = await import('./index');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    clearAllData();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ ok: true }));
    expect(recordedBeforeRemoval).toEqual([true, true]);
    expect(Object.keys(local.dump()).sort()).toEqual([`${APP_PREFIX}event:clear`, 'other']);
    expect(session.dump()).toEqual({});
    unsubscribe();
  });

  it('消去世代を先に記録できなくても、消して空きを作ってから記録し直す', async () => {
    vi.resetModules();
    const local = memoryStorage({ [`${INPUT_PREFIX}json`]: 'large' });
    const set = local.setItem;
    local.setItem = (key: string, value: string) => {
      if (local.getItem(`${INPUT_PREFIX}json`) !== null) throw new DOMException('容量不足', 'QuotaExceededError');
      set(key, value);
    };
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('BroadcastChannel', undefined);
    const { subscribeClearData, clearAllData } = await import('./index');
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    clearAllData();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ ok: true }));
    expect(Object.keys(local.dump())).toEqual([`${APP_PREFIX}event:clear`]);
    unsubscribe();
  });

  it('起動時の整理で古いキーが消えても、全消去の通知として扱わない', async () => {
    /** 新しく開いたタブは起動時に古いキー（以前の版の保存設定・入力など）を消すため、通知として扱うと、開いているほかのタブを全消去させる */
    vi.resetModules();
    const { subscribeClearData, isClearingData } = await import('./index');
    const target = new EventTarget();
    const local = memoryStorage();
    const session = memoryStorage({ [`${INPUT_PREFIX}base64`]: 'keep' });
    vi.stubGlobal('window', target);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('BroadcastChannel', undefined);
    const listener = vi.fn();
    const unsubscribe = subscribeClearData(listener);
    for (const key of [`${APP_PREFIX}setting:persistInputs`, `${APP_PREFIX}setting:persistInputs:json`, `${INPUT_PREFIX}json`, `${APP_PREFIX}b64:wrap`]) {
      target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: null, storageArea: local }));
    }
    expect(listener).not.toHaveBeenCalled();
    expect(isClearingData()).toBe(false);
    expect(session.dump()).toEqual({ [`${INPUT_PREFIX}base64`]: 'keep' });
    unsubscribe();
  });
});
