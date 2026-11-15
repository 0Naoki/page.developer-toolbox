/** 例外が Error でないとき（文字列やオブジェクトが投げられたとき）に表示する文言 */
export const UNKNOWN_ERROR = '処理できませんでした。入力を確認してください。';

/**
 * 例外から、画面に表示する文言を取り出す。
 *
 * @remarks
 * `(e as Error).message` は、Error 以外が投げられると undefined になり、表示の側（detailPreview）で例外になる。
 * Error 以外の値は中身を表示しない（入力やオブジェクトの内容をそのまま文言にしない）。
 *
 * @param fallback Error 以外が投げられたときの文言
 */
export function errorMessage(e: unknown, fallback = UNKNOWN_ERROR): string {
  return e instanceof Error ? e.message : fallback;
}

/** attempt の結果。成功なら run の戻り値のプロパティを ok と並べて持つ */
export type Attempt<T extends object> = (T & { ok: true }) | { ok: false; error: string };

/**
 * 描画中の計算を実行し、例外を表示用の結果にする。
 *
 * @remarks
 * 描画中の例外は画面全体をエラー表示に切り替えるため、入力によって失敗しうる計算はこれを通す。
 * 戻り値のプロパティはそのまま結果に並ぶ（`attempt(() => ({ info }))` なら `result.info`）。
 *
 * @example
 * const result = useMemo(() => (input.trim() ? attempt(() => ({ info: inspectId(input) })) : null), [input]);
 */
export function attempt<T extends object>(run: () => T): Attempt<T> {
  try {
    return { ...run(), ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
