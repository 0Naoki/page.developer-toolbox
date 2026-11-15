/**
 * 計算 Worker（src/calculation/）の入力の上限・制限時間・状態。
 *
 * @remarks
 * ツールの画面が、計算の処理（ツールの計算処理をまとめて読み込む src/calculation/）を読み込まずに参照できるよう、ここに分ける。
 */

export const MAX_CALCULATION_INPUT = 8_000_000;
/** 利用者に見せる上限の言い方 */
export const MAX_CALCULATION_INPUT_LABEL = `半角${MAX_CALCULATION_INPUT / 10_000}万文字相当`;
/**
 * テキストとして読み込むファイルの上限（バイト）。
 *
 * @remarks
 * UTF-8 は UTF-16 コード単位あたり最大3バイト（Shift_JIS は最大2バイト）なので、計算の上限を超えることが確実なファイルは、
 * 読み込む前に断る（巨大なファイルの読み込みと表示で画面を止めないため）。読み込んだ後にも、文字数が計算の上限以下かを確かめる
 */
export const MAX_CALCULATION_FILE_BYTES = MAX_CALCULATION_INPUT * 3;
/** 上限を超えたときのメッセージ（画面側の事前の確認と、Worker の計算の両方で使う） */
export const INPUT_TOO_LARGE = `入力が大きすぎます。分割して入力してください（上限は${MAX_CALCULATION_INPUT_LABEL}）。`;
export const CALCULATION_TIMEOUT = 10_000;
export type CalculationState = 'pending' | 'cancelled' | 'done' | 'error';
