import { describe, expect, it } from 'vitest';
import bugReport from '../.github/ISSUE_TEMPLATE/bug_report.yml?raw';
import { APP_SETTING_KEYS } from './lib/settings';
import { isToolId, toolCatalog as tools } from './toolCatalog';
import { tools as screens } from './registry';

describe('ツールの一覧', () => {
  it('不具合報告のテンプレートの「ツール」の選択肢に、全ツールがツールの一覧と同じ表記で並んでいる', () => {
    /** ツールを追加したときにテンプレートへの追加が漏れ、その不具合を報告できなくなっていたため */
    const start = bugReport.indexOf('      options:\n');
    const end = bugReport.indexOf('    validations:', start);
    const options = bugReport
      .slice(start, end)
      .split('\n')
      .flatMap((l) => (l.startsWith('        - ') ? [l.slice(10)] : []));
    expect(options.slice(0, -1)).toEqual(tools.map((t) => t.name));
    expect(options.at(-1)).toBe('全体（サイドバー・検索・保存設定など）');
  });
});

describe('ツールのフォルダ', () => {
  it('一覧のフォルダ名が重ならず、src/tools/ のどのフォルダにも一覧の項目がある（画面を読み込めないツール・一覧から漏れたツールがない）', () => {
    const folders = tools.map((t) => t.folder);
    expect(new Set(folders).size).toBe(folders.length);
    const onDisk = Object.keys(import.meta.glob('/src/tools/*/index.tsx')).map((f) => f.split('/')[3] ?? '').sort();
    expect([...folders].sort()).toEqual(onDisk);
    expect(screens.map((t) => t.id)).toEqual(tools.map((t) => t.id));
  });
});

describe('ツール ID と保存キー', () => {
  it('ツール ID が、保存キーの予約した先頭・アプリ全体の設定と重ならない', () => {
    /** 保存キーの先頭にツール ID をそのまま使うため、重なると別の用途のキー（入力・全消去の世代・表示設定の名前空間など）を読み書きする */
    const reserved = ['input', 'setting', 'event', 'pref', ...APP_SETTING_KEYS];
    const ids = tools.map((t) => t.id);
    expect(ids.filter((id) => reserved.includes(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !/^[a-z0-9-]+$/.test(id))).toEqual([]);
  });

  it('isToolId は一覧のツールの ID だけを通す（削除したツールの ID・文字列でない値は通さない）', () => {
    for (const tool of tools) expect(isToolId(tool.id), tool.id).toBe(true);
    for (const value of ['removed-tool', 'JSON', '', ' json', null, undefined, 1, ['json'], { id: 'json' }]) expect(isToolId(value), String(value)).toBe(false);
  });
});
