/**
 * 計測スクリプト（scripts/*.mjs）の検査。
 *
 * @remarks
 * スクリプトは型チェックの対象外で（Node の型定義の依存パッケージを増やさないため）、計測のときにしか実行しない。
 * ファイルの移動や関数の名前の変更で壊れても、実行するまで気づけないため、実行せずに確かめられることをここで確かめる。
 */
import { describe, expect, it } from 'vitest';
import { exists, scriptSources } from './documentSources.testing';
import { parseSource } from './sourceScan.testing';

type Node = { type: string; [key: string]: unknown };

const packageJson = Object.values(import.meta.glob<string>('/package.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '{}';
const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const packages = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);

const nameOf = (node: unknown): string | null => {
  const n = node as { type?: string; name?: unknown; value?: unknown } | null;
  if (n?.type === 'Identifier' && typeof n.name === 'string') return n.name;
  if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
  return null;
};

/** 静的 import の読み込み先と、名前を指定して読み込む名前 */
function importsOf(file: string, source: string): { from: string; names: string[] }[] {
  const program = (parseSource(source, file) as { program: unknown }).program as { body: Node[] };
  return program.body.filter((n) => n.type === 'ImportDeclaration').map((n) => ({
    from: String((n.source as { value: unknown }).value),
    names: (n.specifiers as Node[]).filter((s) => s.type === 'ImportSpecifier').map((s) => nameOf(s.imported) ?? ''),
  }));
}

/** export した名前（関数・変数の宣言と、export { … }） */
function exportsOf(file: string, source: string): Set<string> {
  const program = (parseSource(source, file) as { program: unknown }).program as { body: Node[] };
  const names = new Set<string>();
  for (const n of program.body.filter((node) => node.type === 'ExportNamedDeclaration')) {
    const declaration = n.declaration as Node | null;
    if (declaration?.type === 'VariableDeclaration') for (const d of declaration.declarations as Node[]) names.add(nameOf(d.id) ?? '');
    else if (declaration) names.add(nameOf(declaration.id) ?? '');
    for (const s of (n.specifiers as Node[] | undefined) ?? []) names.add(nameOf(s.exported) ?? '');
  }
  return names;
}

/** パッケージの名前（@scope/name/sub なら @scope/name） */
const packageName = (spec: string): string => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

describe('計測スクリプト', () => {
  const scripts = Object.entries(scriptSources);

  it('スクリプトを集めている', () => {
    expect(scripts.map(([file]) => file)).toContain('/scripts/measure-large-inputs.mjs');
  });

  it.each(scripts)('%s：読み込む先（Node の標準・依存パッケージ・ほかのスクリプトの export）がある', (file, source) => {
    const problems: string[] = [];
    for (const { from, names } of importsOf(file, source)) {
      if (from.startsWith('node:')) continue;
      if (from.startsWith('.')) {
        const target = new URL(from, `http://repo${file}`).pathname;
        const targetSource = scriptSources[target];
        if (targetSource === undefined) { problems.push(`${from}（ファイルがありません）`); continue; }
        const exported = exportsOf(target, targetSource);
        for (const name of names) if (!exported.has(name)) problems.push(`${from} の ${name}（export されていません）`);
        continue;
      }
      if (!packages.has(packageName(from))) problems.push(`${from}（package.json の依存にありません）`);
    }
    expect(problems).toEqual([]);
  });

  it.each(scripts)('%s：読み込むファイルのパス（src/tools/unix-time/epoch.ts など）が、存在するファイルを指している', (file, source) => {
    /** 型チェックの対象外で、ファイルを移すと実行するまで壊れたことに気づけないため */
    const missing = [...parseSource(source, file).code.matchAll(/['"`]((?:src|e2e|docs)\/[^'"`\s$]+?\.(?:tsx?|mjs|json))['"`]/g)]
      .map(([, path = '']) => path)
      .filter((path) => !exists(`/${path}`));
    expect(missing).toEqual([]);
  });

  it.each(scripts.filter(([, source]) => /\bconst entry = '/.test(source)))(
    '%s：比べる計算処理（entry）が、スクリプトの使う関数・定数を export している',
    async (file, source) => {
      const entry = /\bconst entry = '([^']+)'/.exec(source)?.[1] ?? '';
      const used = [...new Set([...parseSource(source, file).code.matchAll(/\bapi\.(\w+)/g)].map(([, name = '']) => name))];
      expect(used.length, '計算処理の使い方（api.名前）が見つかりません').toBeGreaterThan(0);
      const module = (await import(/* @vite-ignore */ `/${entry}`)) as Record<string, unknown>;
      expect(used.filter((name) => !(name in module)), `${entry} に export がない名前`).toEqual([]);
    },
  );
});
