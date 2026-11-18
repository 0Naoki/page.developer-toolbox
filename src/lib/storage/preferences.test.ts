import { describe, expect, it } from 'vitest';
import { pruneInvalidSetting, readStoredSetting, storedSettingUpdateBase, settingStorageKey, settingValueFromEvent, writeStoredSetting } from './preferences';
import { memoryStorage } from './memory.fixtures';
import { oneOf } from '../settings';

describe('表示設定の保存キー', () => {
  it('名前空間 pref: のキーに保存する', () => {
    expect(settingStorageKey('json:indent')).toBe('dev-toolbox:pref:json:indent');
    expect(settingStorageKey('theme')).toBe('dev-toolbox:pref:theme');
  });
});

describe('表示設定の保存とタブ間通知', () => {
  const key = settingStorageKey('theme');
  const validate = oneOf('system', 'light', 'dark');
  const event = (storage: ReturnType<typeof memoryStorage>, changed: string | null) => ({ storageArea: storage, key: changed });

  it('更新は他タブの新しい値を基準にし、未保存・編集中・読み取り失敗なら現在値を守る', () => {
    const storage = memoryStorage({ [key]: '"dark"', unrelated: 'keep' });
    expect(storedSettingUpdateBase(storage, key, 'light', 'system', validate, false)).toBe('dark');
    expect(storedSettingUpdateBase(storage, key, 'light', 'system', validate, true)).toBe('light');
    expect(storedSettingUpdateBase(storage, key, 'editing', 'system', validate, false)).toBe('editing');
    const denied = { getItem: () => { throw new Error('denied'); } };
    expect(storedSettingUpdateBase(denied, key, 'light', 'system', validate, false)).toBe('light');
    expect(readStoredSetting(denied, key, 'system', validate)).toBe('system');
    storage.removeItem(key);
    expect(storedSettingUpdateBase(storage, key, 'light', 'system', validate, false)).toBe('system');
    expect(storage.getItem('unrelated')).toBe('keep');
  });

  it('有効な値は保存し、初期値へ戻すとキーを消し、検証に通らない途中の値では保存領域に触れない', () => {
    const storage = memoryStorage();
    writeStoredSetting(storage, key, '"dark"', '"system"', validate);
    expect(storage.dump()).toEqual({ [key]: '"dark"' });
    writeStoredSetting(storage, key, '"invalid"', '"system"', validate);
    expect(storage.dump()).toEqual({ [key]: '"dark"' });
    writeStoredSetting(storage, key, '"system"', '"system"', validate);
    expect(storage.dump()).toEqual({});
  });

  it('この設定のキーと全削除（key が null）の通知だけを受け取り、ほかのキーや別の保存領域の通知は無視する', () => {
    const storage = memoryStorage({ [key]: '"light"' });
    expect(settingValueFromEvent(storage, key, event(storage, key))).toEqual({ raw: '"light"' });
    expect(settingValueFromEvent(storage, key, event(storage, 'dev-toolbox:pref:recent'))).toBeNull();
    expect(settingValueFromEvent(storage, key, event(memoryStorage(), key))).toBeNull();
    storage.removeItem(key);
    expect(settingValueFromEvent(storage, key, event(storage, null))).toEqual({ raw: null });
  });

  it('復元できない値だけを消し、有効な値は残す', () => {
    const invalid = memoryStorage({ [key]: '"invalid"' });
    pruneInvalidSetting(invalid, key, validate);
    expect(invalid.dump()).toEqual({});
    const valid = memoryStorage({ [key]: '"dark"' });
    pruneInvalidSetting(valid, key, validate);
    expect(valid.dump()).toEqual({ [key]: '"dark"' });
  });

  it('保存に失敗したときは例外を投げ、前の値を残す（画面の操作は usePreference が続ける）', () => {
    const storage = memoryStorage({ [key]: '"dark"' });
    storage.setItem = () => { throw new Error('容量超過'); };
    expect(() => writeStoredSetting(storage, key, '"light"', '"system"', validate)).toThrow('容量超過');
    expect(storage.getItem(key)).toBe('"dark"');
  });
});
