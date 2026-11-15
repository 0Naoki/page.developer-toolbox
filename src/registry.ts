import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { CATEGORIES, toolCatalog, type ToolId, type ToolMeta } from './toolCatalog';

/**
 * ツールの画面（`src/tools/<フォルダ名>/index.tsx` の default export）。ツールごとに別のファイルに分け、開いたときに読み込む。
 * どのフォルダにも一覧（src/toolCatalog.ts）の項目があることは src/registry.test.ts で確かめる
 */
const screens = import.meta.glob<{ default: ComponentType }>('./tools/*/index.tsx');

/** 画面を付けたツール */
export type ToolDef = ToolMeta & { readonly id: ToolId; readonly component: LazyExoticComponent<ComponentType> };

/**
 * ツールの一覧（src/toolCatalog.ts）に画面を付けたもの。
 * サイドバー・トップページ・コマンドパレットは、ここから作る
 */
export const tools: readonly ToolDef[] = toolCatalog.map((meta) => {
  const load = screens[`./tools/${meta.folder}/index.tsx`];
  if (!load) throw new Error(`ツールの画面がありません：src/tools/${meta.folder}/index.tsx`);
  return { ...meta, component: lazy(load) };
});

export const findTool = (id: string | undefined) => tools.find((t) => t.id === id);

/** ID のツール。isToolId で確かめた ID（または型が ToolId の値）なので、必ず見つかる */
export const toolOf = (id: ToolId): ToolDef => findTool(id)!;

export const toolsByCategory = () =>
  CATEGORIES.map((category) => ({ category, tools: tools.filter((t) => t.category === category) }));

export function searchTools(query: string): readonly ToolDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  return tools.filter((t) =>
    [t.name, t.description, t.id, t.category, ...t.tags].some((s) => s.toLowerCase().includes(q)),
  );
}
