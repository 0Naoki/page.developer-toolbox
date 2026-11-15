import { describe, expect, it } from 'vitest';
import { codeSources, markdown, exists } from './documentSources.testing';
import { headingAnchors } from './documentMarkdown.testing';

describe('ドキュメントのリンクとパス', () => {
  it('Markdown の相対リンクと見出しへのリンクが、存在するファイル・見出しを指している', () => {
    expect(Object.keys(markdown)).toContain('/docs/USAGE.md');
    const broken: string[] = [];
    for (const [file, text] of Object.entries(markdown)) {
      for (const [, target = ''] of text.replace(/```[\s\S]*?```/g, '').matchAll(/\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        const [pathPart, hash] = target.split('#') as [string, string | undefined];
        /** 「src/foo.ts:42」のような行番号付きのリンクは、ファイルだけを確かめる */
        const path = pathPart === '' ? file : decodeURIComponent(new URL(pathPart.replace(/:\d+$/, ''), `http://repo${file}`).pathname);
        if (!exists(path)) {
          broken.push(`${file} → ${target}（ファイルがありません）`);
          continue;
        }
        if (hash !== undefined && path.endsWith('.md') && !headingAnchors(markdown[path] ?? '').has(decodeURIComponent(hash).toLowerCase())) {
          broken.push(`${file} → ${target}（見出しがありません）`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('コード表記で書いたファイルのパス（`src/lib/storage/index.ts` など）が、存在するファイルを指している', () => {
    /**
     * リンクにしていないパスも、ファイルの移動・削除で古くならないように確かめる。
     * 「<tool-id>」「*」を含む書き方の例と、過去の状態を残す運用記録（docs/records）は対象外
     */
    const missing: string[] = [];
    for (const [file, text] of Object.entries(markdown)) {
      if (file.startsWith('/docs/records/')) continue;
      for (const [, path = ''] of text.matchAll(/`((?:src|e2e|scripts|docs|\.github)\/[^`\s]+?\.(?:tsx?|mjs|css|md|ya?ml|json))(?::\d+)?`/g)) {
        if (/[<>*]/.test(path)) continue;
        if (!exists(`/${path}`)) missing.push(`${file} → ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('コードのコメントや文言に書いたファイルのパス（src/lib/worker/runWorker.ts など）が、存在するファイルを指している', () => {
    /**
     * ファイルを移したときに、コメントの古いパスは型チェックでも Markdown の検査でも見つからないため。
     * 「/src/…」のように先頭が「/」の書き方は、静的検査の規則の例（実在しないファイルを含む）に使うため対象外。
     * 「<フォルダ名>」「*」・テンプレートの式（${…}）を含む書き方の例も対象外
     */
    const missing: string[] = [];
    for (const [file, text] of Object.entries(codeSources)) {
      for (const [, path = ''] of text.matchAll(/(?:^|[\s(（`'"])((?:src|e2e|scripts|docs|\.github)\/[^\s`'"()（）、。]+?\.(?:tsx|ts|mjs|css|md|ya?ml|json))(?![\w.])/gm)) {
        if (/[<>*$]/.test(path)) continue;
        if (!exists(`/${path}`)) missing.push(`${file} → ${path}`);
      }
    }
    expect(Object.keys(codeSources).length).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('コードのパスの読み方：拡張子の長いものを優先し、先頭が「/」の例と置き換え用の書き方は読まない', () => {
    const text = "// src/app/ToolPage.tsx と src/lib/errors.ts\nconst rule = { file: '/src/lib/example.ts' };\n/** src/tools/<フォルダ名>/index.tsx */";
    const found = [...text.matchAll(/(?:^|[\s(（`'"])((?:src|e2e|scripts|docs|\.github)\/[^\s`'"()（）、。]+?\.(?:tsx|ts|mjs|css|md|ya?ml|json))(?![\w.])/gm)].map((m) => m[1]);
    expect(found).toEqual(['src/app/ToolPage.tsx', 'src/lib/errors.ts', 'src/tools/<フォルダ名>/index.tsx']);
  });
});
