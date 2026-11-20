/**
 * index.html の、公開先を示す指定（canonical・OGP）の検査。
 *
 * @remarks
 * 正式な公開先は SECURITY.md の「正式な公開先」にある。公開先を移したときに、index.html だけが古い URL のまま残らないようにする。
 */
import { expect, it } from 'vitest';
import { toolCatalog } from './toolCatalog';

const raw = (glob: Record<string, string>) => Object.values(glob)[0] ?? '';
const html = raw(import.meta.glob<string>('/index.html', { query: '?raw', import: 'default', eager: true }));
const security = raw(import.meta.glob<string>('/SECURITY.md', { query: '?raw', import: 'default', eager: true }));

it('canonical と og:url は、SECURITY.md の正式な公開先と同じ', () => {
  const official = /正式な公開先は (https:\/\/\S+?) だけです/.exec(security)?.[1];
  expect(official).toMatch(/^https:\/\/[a-z0-9-]+\.github\.io\/page\.developer-toolbox\/$/);
  expect(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]).toBe(official);
  expect(/<meta property="og:url" content="([^"]+)"/.exec(html)?.[1]).toBe(official);
});

it('共有のカードに、題名・説明・言語を示す（外部の画像は読み込まない）', () => {
  expect(html).toContain('<meta property="og:title" content="Dev Toolbox" />');
  expect(html).toMatch(/<meta property="og:description" content="[^"]+" \/>/);
  expect(html).toContain('<meta property="og:locale" content="ja_JP" />');
  /** 説明に書いたツールの数が、一覧と合っている（ツールを足したときに、古い数のまま残らないように） */
  expect(/<meta property="og:description" content="[^"]*（(\d+)ツール）/.exec(html)?.[1]).toBe(String(toolCatalog.length));
  /** og:image は外部から読める絶対 URL が要るため、用意するまで置かない */
  expect(html).not.toContain('og:image');
});
