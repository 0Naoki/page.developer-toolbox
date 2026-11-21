import { describe, expect, it } from 'vitest';
import { INPUT_TOOLS } from './lib/storage';
import { toolCatalog as tools } from './toolCatalog';
import { markdown, testSources, toolScreens, toolFiles } from './documentSources.testing';
import { markedSection, sectionOf } from './documentMarkdown.testing';

describe('ドキュメントとコードの対応', () => {
  it('README の収録ツールの件数と一覧が、ツールの一覧と同じ表記・順番になっている', () => {
    /** ツールを追加・削除したときに、README の件数や一覧の更新が漏れないように */
    const readme = markdown['/README.md'] ?? '';
    const start = readme.indexOf('## 収録ツール');
    const section = readme.slice(start, readme.indexOf('\n## ', start + 1));
    expect(section).toContain(`## 収録ツール（${tools.length}）`);
    const names = section.split('\n').flatMap((l) => {
      const cells = l.split('|').map((c) => c.trim());
      const name = cells[2] ?? '';
      return l.startsWith('|') && cells.length > 3 && !/^-+$/.test(name) && name !== 'ツール' ? [name] : [];
    });
    expect(names).toEqual(tools.map((t) => t.name));
  });

  /** INPUT_TOOLS はツールの一覧（src/toolCatalog.ts）の `savesInput` から作るため、一覧にない ID を指すことはない */

  it('入力を保存しないツール（INPUT_TOOLS にないツール）が、USAGE と SECURITY の「保存しません」の文に載っている', () => {
    /** INPUT_TOOLS のツールの入力は sessionStorage に残るため、残さないツールを文書から漏らすと、利用者が保存されると誤解する */
    const saved = new Set<string>(INPUT_TOOLS);
    const unsaved = tools.filter((t) => !saved.has(t.id)).map((t) => t.name);
    expect(unsaved.length).toBeGreaterThan(0);
    for (const file of ['/docs/USAGE.md', '/SECURITY.md']) {
      const section = markedSection(markdown[file] ?? '', 'unsaved-inputs');
      expect(section).toContain('sessionStorage にも保存しません');
      expect(unsaved.filter((name) => !section.includes(name)), file).toEqual([]);
    }
  });

  it('src の直下の単体テストが、どれも TESTING の「ソースとドキュメントの検査」の表に載っている', () => {
    /** アプリ全体を読んで確かめる検査を足したときに、何を確かめるかの説明から漏れないように */
    const tests = Object.keys(import.meta.glob('/src/*.test.ts')).map((file) => file.slice(1));
    expect(tests.length).toBeGreaterThan(5);
    const rows = sectionOf(markdown['/docs/TESTING.md'] ?? '', '## ソースとドキュメントの検査').split('\n').filter((line) => line.startsWith('| '));
    expect(tests.filter((test) => !rows.some((row) => row.includes(`\`${test}\``)))).toEqual([]);
  });

  it('E2E のファイルが、どれも TESTING の回帰テストの表に載っている', () => {
    /** ファイルを分けたり足したりしたときに、残すべき検証の表から漏れないように */
    const specs = Object.keys(import.meta.glob('/e2e/*.spec.ts')).map((file) => file.slice(1));
    expect(specs.length).toBeGreaterThan(0);
    /** 回帰テストの節の表だけを読む（ほかの節の表に書いたファイル名を、担当として数えない） */
    const rows = sectionOf(markdown['/docs/TESTING.md'] ?? '', '## 既知不具合を守るテスト').split('\n').filter((line) => line.startsWith('| '));
    expect(specs.filter((spec) => !rows.some((row) => row.includes(`\`${spec}\``)))).toEqual([]);
  });

  it('TESTING の「既知不具合を守るテスト」の各行が、担当のファイルの先頭のコメントに残すべき検証として載っている', () => {
    /** 表には担当のファイルだけを書き、残すべき検証はテストの側に置く。テストを移動・統合したときに、検証の一覧が迷子にならないように */
    /** 担当の表（検査対象｜ファイル）と「入力の境界と組み合わせ」の表（条件｜テスト）の両方を読む。どちらも1列目の名前で、担当のファイルに載せる */
    const regression = sectionOf(markdown['/docs/TESTING.md'] ?? '', '## 既知不具合を守るテスト');
    const rows = regression.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| 検査対象') && !line.startsWith('| 条件'));
    expect(rows.length).toBeGreaterThan(40);
    const ids = rows.map((row) => /<!-- regression:(R\d+) -->/.exec(row)?.[1]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(rows.length);
    const missing = rows.flatMap((row) => {
      const [, target = '', files = ''] = row.split('|').map((cell) => cell.trim());
      const paths = [...files.matchAll(/`([^`]+\.tsx?)`/g)].map(([, path]) => path ?? '');
      const owner = paths.find((path) => /^e2e\/.*\.spec\.ts$/.test(path)) ?? paths[0] ?? '';
      const header = /^\/\*\*[\s\S]*?\*\//.exec(testSources[`/${owner}`] ?? '')?.[0] ?? '';
      const id = /<!-- regression:(R\d+) -->/.exec(target)?.[1];
      return header.includes('回帰テストとして残す検証') && id && header.includes(`[${id}]`) ? [] : [`${owner} の先頭に「${id ?? target}」がありません`];
    });
    expect(missing).toEqual([]);
  });

  it('ファイルが3つ以上あるツールの index.tsx の先頭のコメントが、フォルダのファイルをすべて挙げている', () => {
    /** ファイルの分担は ARCHITECTURE ではなく、ツールの画面の先頭に書く。ファイルを足したときに書き漏らさないように */
    const byTool = new Map<string, string[]>();
    for (const file of toolFiles) {
      const tool = file.split('/')[3] ?? '';
      byTool.set(tool, [...(byTool.get(tool) ?? []), file]);
    }
    expect(byTool.size).toBeGreaterThan(10);
    const missing = [...byTool].flatMap(([tool, list]) => {
      if (list.length < 3) return [];
      const header = /^\/\*\*[\s\S]*?\*\//.exec(toolScreens[`/src/tools/${tool}/index.tsx`] ?? '')?.[0] ?? '';
      return list.map((file) => file.split('/').pop() ?? '')
        .filter((name) => name !== 'index.tsx' && !header.includes(`\`${name}\``))
        .map((name) => `src/tools/${tool}/index.tsx の先頭に ${name} の説明がありません`);
    });
    expect(missing).toEqual([]);
  });

  it('依存パッケージの検査（npm audit）のオプションを、CI と文書に直接書かない（package.json の audit:signatures・audit:deps を使う）', () => {
    /** 手元と CI でオプションが食い違わないよう、コマンドは package.json の scripts の1か所だけに書く */
    const workflows = import.meta.glob<string>('/.github/workflows/*.yml', { query: '?raw', import: 'default', eager: true });
    const pkg = Object.values(import.meta.glob<string>('/package.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
    const scripts = (JSON.parse(pkg) as { scripts: Record<string, string> }).scripts;
    expect(scripts['audit:signatures']).toMatch(/^npm audit signatures$/);
    expect(scripts['audit:deps']).toMatch(/^npm audit /);
    const direct = Object.entries({ ...workflows, ...markdown })
      .filter(([file]) => !file.startsWith('/docs/records/'))
      .flatMap(([file, text]) => text.split('\n').filter((line) => /\bnpm audit (?:signatures|--)/.test(line)).map((line) => file + '：' + line.trim()));
    expect(direct).toEqual([]);
  });
});
