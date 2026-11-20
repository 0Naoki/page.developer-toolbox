/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - [R008] 入力を localStorage に保存しない：編集しても localStorage に書かず、localStorage に残った入力も読まないこと
 * - 離れていた間の全消去：入力を保存した消去世代と今の世代が違えば、起動時にこのタブの入力を捨てること（捨て切れなければ次の起動でも捨て直す）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as storageEntry from './index';
import { prepareStorage, readInput, saveInput } from './index';
/** 入口（index.ts）では公開していない低水準の処理そのものを確かめるため、内部モジュールから直接読み込む */
import { APP_PREFIX, clearAppData, CLEAR_KEY, INPUT_PREFIX, PREF_PREFIX, TAB_GENERATION_KEY } from './io';
import { memoryStorage } from './memory.fixtures';
import { toolCatalog } from '../../toolCatalog';

/** 起動時の整理に渡す、ツールの一覧の全ツールの ID */
const TOOL_IDS = toolCatalog.map((tool) => tool.id);

describe('保存領域の入口', () => {
  it('ロックや消去世代の記録をしない低水準の処理を公開しない', () => {
    /** 画面やフックから呼ぶと、全消去や別タブの保存の決まりを迂回できるため */
    for (const name of ['clearAppData', 'INPUT_PREFIX', 'pruneStaleKeys', 'safe', 'keysOf']) {
      expect(Object.keys(storageEntry), name).not.toContain(name);
    }
  });

  it('入力を localStorage に保存する設定を公開しない', () => {
    for (const name of ['getPersistInputs', 'changePersistInputs', 'setPersistInputs']) {
      expect(Object.keys(storageEntry), name).not.toContain(name);
    }
  });
});

describe('入力の保存先', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('編集した入力はこのタブ（sessionStorage）にだけ書き、localStorage には書かない', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    saveInput('json', '{"a":1}', '');
    expect(session.dump()).toEqual({ [`${INPUT_PREFIX}json`]: '{"a":1}' });
    expect(local.dump()).toEqual({});
    expect(readInput('json', '')).toBe('{"a":1}');
  });

  it('localStorage に入力が残っていても読まず、初期値に戻したときはキーを消す', () => {
    const local = memoryStorage({ [`${INPUT_PREFIX}json`]: 'old-local' });
    const session = memoryStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    expect(readInput('json', 'initial')).toBe('initial');
    saveInput('json', 'new', '');
    expect(session.getItem(`${INPUT_PREFIX}json`)).toBe('new');
    saveInput('json', '', '');
    expect(session.dump()).toEqual({});
  });

  it('保存できないときは例外を投げる（呼び出し側で未保存の入力として示す）', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', { ...memoryStorage(), setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } });
    expect(() => saveInput('json', 'x', '')).toThrow();
  });

  it('全消去はこのアプリのデータだけを消す', () => {
    const local = memoryStorage({ [`${APP_PREFIX}a`]: '1', [`${INPUT_PREFIX}b`]: '2', other: '3' });
    clearAppData(local);
    expect(local.dump()).toEqual({ other: '3' });
  });
});

describe('起動時の古いキーの整理', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('localStorage は、今あるツール・アプリ全体の表示設定と消去世代だけを残し、以前の版が残したキーと削除したツールの設定を消す', () => {
    const local = memoryStorage({
      /** 残すもの */
      [`${PREF_PREFIX}json:indent`]: '4',
      [`${PREF_PREFIX}theme`]: '"dark"',
      [CLEAR_KEY]: 'generation',
      other: 'keep',
      /** 消すもの：以前の版が保存した入力（同じオリジンのほかのサイトから読める）・保存設定・以前の形式の表示設定・削除したツールの設定 */
      [`${INPUT_PREFIX}json`]: '{"secret":1}',
      [`${APP_PREFIX}setting:persistInputs`]: '["json"]',
      [`${APP_PREFIX}setting:persistInputs:json`]: '1',
      [`${APP_PREFIX}json:indent`]: '2',
      [`${APP_PREFIX}b64:wrap`]: 'true',
      [`${PREF_PREFIX}sql:indent`]: '2',
    });
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memoryStorage());
    prepareStorage(TOOL_IDS);
    expect(local.dump()).toEqual({
      [`${PREF_PREFIX}json:indent`]: '4',
      [`${PREF_PREFIX}theme`]: '"dark"',
      [CLEAR_KEY]: 'generation',
      other: 'keep',
    });
  });

  it('sessionStorage は、入力を保存するツールの入力だけを残す（削除したツール・以前の略称・機密値を扱うツールのキーは消す）', () => {
    const session = memoryStorage({
      [`${INPUT_PREFIX}count`]: 'abc',
      [`${INPUT_PREFIX}bizdays:from`]: '2026-08-13',
      [`${INPUT_PREFIX}sql:draft`]: 'select 1',
      [`${INPUT_PREFIX}biz:from`]: '2026-08-13',
      [`${INPUT_PREFIX}jwt`]: 'eyJ...',
      [`${APP_PREFIX}legacy:handled`]: '[]',
      other: 'keep',
    });
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', session);
    prepareStorage(TOOL_IDS);
    expect(session.dump()).toEqual({ [`${INPUT_PREFIX}count`]: 'abc', [`${INPUT_PREFIX}bizdays:from`]: '2026-08-13', other: 'keep' });
  });

  it('1つのキーを消せなくても、残りのキーの整理は続ける', () => {
    const data = memoryStorage({ [`${INPUT_PREFIX}json`]: 'a', [`${INPUT_PREFIX}csv`]: 'b' });
    const local = { ...data, removeItem: (key: string) => { if (key.endsWith('json')) throw new DOMException('denied', 'SecurityError'); data.removeItem(key); } };
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memoryStorage());
    expect(() => prepareStorage(TOOL_IDS)).not.toThrow();
    expect(data.dump()).toEqual({ [`${INPUT_PREFIX}json`]: 'a' });
  });

  describe('回帰：このタブを離れていた間の全消去', () => {
    /** 全消去の通知はアプリを開いているタブにしか届かず、別のサイトへ移動していたタブに戻ると、消去前の入力が復元されていた */
    const input = `${INPUT_PREFIX}json`;
    const setup = (local: Record<string, string>, session: Record<string, string>) => {
      const l = memoryStorage(local);
      const s = memoryStorage(session);
      vi.stubGlobal('localStorage', l);
      vi.stubGlobal('sessionStorage', s);
      prepareStorage(TOOL_IDS);
      return { local: l, session: s };
    };

    it('入力を保存した世代と今の世代が違えば、入力を捨てて今の世代を記録する', () => {
      const { session } = setup({ [CLEAR_KEY]: 'after' }, { [input]: '{"secret":1}', [TAB_GENERATION_KEY]: 'before', other: 'keep' });
      expect(session.dump()).toEqual({ [TAB_GENERATION_KEY]: 'after', other: 'keep' });
      expect(readInput('json', '')).toBe('');
    });

    it('localStorage.clear() などで今の世代がなくなっていても、記録した世代と違うので捨てる', () => {
      const { session } = setup({}, { [input]: '{"secret":1}', [TAB_GENERATION_KEY]: 'before' });
      expect(session.dump()).toEqual({});
    });

    it('世代の記録がない入力は、今の世代があれば捨てる（以前の版が保存した入力を含む）', () => {
      const { session } = setup({ [CLEAR_KEY]: 'after' }, { [input]: '{"secret":1}' });
      expect(session.dump()).toEqual({ [TAB_GENERATION_KEY]: 'after' });
    });

    it('同じ世代の入力と、一度も全消去していないときの入力は残す', () => {
      expect(setup({ [CLEAR_KEY]: 'g' }, { [input]: 'a', [TAB_GENERATION_KEY]: 'g' }).session.dump()).toEqual({ [input]: 'a', [TAB_GENERATION_KEY]: 'g' });
      expect(setup({}, { [input]: 'a' }).session.dump()).toEqual({ [input]: 'a' });
    });

    it('捨て切れなかったときは世代を記録し直さず、次の起動でも捨て直す', () => {
      const data = memoryStorage({ [input]: 'a', [TAB_GENERATION_KEY]: 'before' });
      let fail = true;
      const session = { ...data, removeItem: (key: string) => { if (fail && key === input) throw new DOMException('denied', 'SecurityError'); data.removeItem(key); } };
      vi.stubGlobal('localStorage', memoryStorage({ [CLEAR_KEY]: 'after' }));
      vi.stubGlobal('sessionStorage', session);
      prepareStorage(TOOL_IDS);
      expect(data.getItem(TAB_GENERATION_KEY)).toBeNull();
      fail = false;
      prepareStorage(TOOL_IDS);
      expect(data.dump()).toEqual({ [TAB_GENERATION_KEY]: 'after' });
    });
  });

  it('片方の保存領域を参照するだけで例外になる環境でも、もう片方は整理し、例外を投げない', () => {
    const session = memoryStorage({ [`${INPUT_PREFIX}sql:draft`]: 'select 1', [`${INPUT_PREFIX}count`]: 'abc' });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new DOMException('denied', 'SecurityError'); } });
    vi.stubGlobal('sessionStorage', session);
    try {
      expect(() => prepareStorage(TOOL_IDS)).not.toThrow();
      expect(session.dump()).toEqual({ [`${INPUT_PREFIX}count`]: 'abc' });
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
