/**
 * 値を一切変えない JSON 整形。
 *
 * JSON.parse → JSON.stringify で整形すると、
 *   - 9007199254740993 のような大きな整数が丸められる（64ビットIDが別の値になる）
 *   - 1.10 → 1.1、1e2 → 100 のように表記が変わる
 *   - "\u3042" のようなエスケープが展開される
 *   - 重複したキーが黙って消える
 * といった問題が起きる。そのため自前で構文解析し、数値と文字列は元の表記のまま出力する。
 */
import { JsonSyntaxError, lineColumn, parseJsonSource, serializeJsonTree } from '../../lib/jsonTree';
import { formatNumber } from '../../lib/number';

export type JsonIndent = 2 | 4 | 'tab' | 'minify';

export type JsonResult =
  | { ok: true; output: string; warnings: string[] }
  | { ok: false; error: string; line: number; column: number };

/** 整形結果の上限（UTF-16コード単位）。Worker から画面への転送と描画で止まらないように */
export const MAX_OUTPUT = 20_000_000;

/** JSON文字列を整形（または圧縮）する。値の表記は変えない */
export function formatJson(input: string, indent: JsonIndent = 2, sortKeys = false): JsonResult {
  const text = input.replace(/^\uFEFF/, '');
  if (text.trim() === '') return { ok: true, output: '', warnings: [] };
  const warnings: string[] = [];
  try {
    const root = parseJsonSource(text, warnings);
    const unit = indent === 'minify' ? null : indent === 'tab' ? '\t' : ' '.repeat(indent);
    return { ok: true, output: serializeJsonTree(root, unit, sortKeys, 0, MAX_OUTPUT), warnings };
  } catch (e) {
    if (e instanceof JsonSyntaxError) return { ok: false, error: e.message, ...lineColumn(text, e.pos) };
    throw e;
  }
}

/** 画面へ返す警告の件数。大量の重複キーの警告まで転送すると、計算後の転送と描画で止まるため */
const MAX_WARNINGS_SHOWN = 5;

/**
 * 整形し、警告を先頭 {@link MAX_WARNINGS_SHOWN} 件と残りの件数にまとめる（計算 Worker から画面へ返す形）。
 */
export function formatJsonForScreen(input: string, indent: JsonIndent, sortKeys: boolean): JsonResult {
  const result = formatJson(input, indent, sortKeys);
  if (!result.ok || result.warnings.length <= MAX_WARNINGS_SHOWN) return result;
  const rest = result.warnings.length - MAX_WARNINGS_SHOWN;
  return { ...result, warnings: [...result.warnings.slice(0, MAX_WARNINGS_SHOWN), `ほか ${formatNumber(rest)} 件の警告があります`] };
}
