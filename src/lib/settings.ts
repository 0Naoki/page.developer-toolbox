import type { ToolId } from '../toolCatalog';

/** アプリ全体（ツールに属さない）の表示設定のキー */
export const APP_SETTING_KEYS = ['theme', 'recent', 'favorites'] as const;
export type AppSettingKey = (typeof APP_SETTING_KEYS)[number];

/**
 * 表示設定のキー（アプリの接頭辞を除いたもの）。ツールの設定は先頭をツール ID（src/toolCatalog.ts）にする。
 * 略称を使うと、どのツールの設定かを ID から探せなくなるため、型で ID に限る
 */
export type SettingKey = AppSettingKey | `${ToolId}:${string}`;

/** ストレージは実行時の型を保証しないため、表示設定ごとに検証する。 */
export type SettingValidator<T> = (value: unknown) => value is T;

export const isBoolean: SettingValidator<boolean> = (value) => typeof value === 'boolean';
export const isString: SettingValidator<string> = (value) => typeof value === 'string';
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const oneOf = <T extends string | number>(...values: readonly T[]): SettingValidator<T> =>
  (value): value is T => values.some((candidate) => candidate === value);

export const integerBetween = (min: number, max: number): SettingValidator<number> =>
  (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export const arrayOf = <T>(validate: SettingValidator<T>, maxLength: number): SettingValidator<T[]> =>
  (value): value is T[] => Array.isArray(value) && value.length <= maxLength && value.every(validate);

/** JSONや保存値が不正なら、描画・計算に渡す前に既定値へ戻す。 */
export function readSetting<T>(raw: string | null, initial: T, validate: SettingValidator<T>): T {
  if (raw === null) return initial;
  try {
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : initial;
  } catch {
    return initial;
  }
}

/**
 * 保存しようとする文字列が、復元時（{@link readSetting}）の検証を通るか。
 * 画面の状態ではなく保存する文字列を読み直して確かめ、保存と復元で同じ判定にする。
 */
export function isValidSetting<T>(raw: string, validate: SettingValidator<T>): boolean {
  try {
    return validate(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * 更新の基準を選ぶ。編集中の不正な値は、そのタブの値を優先する。
 * 未保存・消去中のときにそのタブの値を優先するのは、呼び出し元（storedSettingUpdateBase）で行う。
 */
export function settingUpdateBase<T>(current: T, raw: string | null, initial: T, validate: SettingValidator<T>): T {
  if (!isValidSetting(JSON.stringify(current), validate)) return current;
  return raw === null ? initial : readSetting(raw, current, validate);
}
