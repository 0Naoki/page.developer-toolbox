import { toolCatalog } from '../../toolCatalog';

/** 入力を保存するツール（src/toolCatalog.ts で `savesInput: true` にしたもの） */
type SavingTool = Extract<(typeof toolCatalog)[number], { savesInput: true }>;

/** 入力を保存できるツールの ID。入力キーの先頭にも、この ID をそのまま使う。機密値を扱うツールは含まない */
export type InputToolId = SavingTool['id'];

/** 入力を保存できるツールの ID の一覧（一覧の順） */
export const INPUT_TOOLS: readonly InputToolId[] = toolCatalog.filter((t): t is SavingTool => t.savesInput).map((t) => t.id);

/** 登録済みツールの入力キー。先頭はツール ID。機密値を扱うツールの ID は含めない。 */
export type InputKey = InputToolId | `${InputToolId}:${string}`;
