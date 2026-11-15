import { formatNumber } from './number';
/** テキストをファイルとして保存させる */
export function downloadText(filename: string, text: string, mime: string, withBom = false) {
  downloadBlob(filename, new Blob([withBom ? '﻿' : '', text], { type: `${mime};charset=utf-8` }));
}

/** バイト列をファイルとして保存させる */
export function downloadBytes(filename: string, bytes: Uint8Array<ArrayBuffer>, mime: string) {
  downloadBlob(filename, new Blob([bytes], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type TextEncodingName = 'utf-8' | 'shift_jis';

/**
 * バイト列を指定した文字コードのテキストにする（Excel が出力する Shift_JIS の CSV に対応）。
 *
 * @throws 選んだ文字コードとして不正なバイトがあるとき
 */
export function decodeText(bytes: Uint8Array, encoding: TextEncodingName): string {
  /** 不正なバイトを置換文字へ変えると、文字化けした値を正常なデータとして保存してしまう。 */
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

/**
 * ファイルの上限の言い方。「5 MiB」「24,000,000 バイト」の形。
 *
 * @remarks
 * 上限ちょうどの値を示すため、formatBytes のように丸めない。1 MiB・1 KiB で割り切れない値はバイト数で書く。
 */
export function formatByteLimit(n: number): string {
  if (n >= 1024 ** 2 && n % 1024 ** 2 === 0) return `${n / 1024 ** 2} MiB`;
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024} KiB`;
  return `${formatNumber(n)} バイト`;
}

/** ファイルの大きさが上限を超えたときの文言。全ツールで同じ言い方にする */
export const fileTooLargeMessage = (limit: number) => `ファイルが大きすぎます（上限 ${formatByteLimit(limit)}）`;

/** ファイルの中身を読めなかったときの文言（選んだ後に移動・削除された、権限がないなど） */
export const FILE_READ_ERROR = 'ファイルを読み込めません（選んだ後に移動・削除された可能性があります）';

/** 利用者にそのまま見せてよい文言を持つ、ファイルの読み込みの失敗 */
export class FileInputError extends Error {
  override name = 'FileInputError';
}

/**
 * 上限を確かめてから、ファイルの中身をバイト列で読む。
 *
 * @throws FileInputError 上限を超えるとき（fileTooLargeMessage）と、読めなかったとき（FILE_READ_ERROR）
 */
export async function readFileWithin(file: File, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > limit) throw new FileInputError(fileTooLargeMessage(limit));
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new FileInputError(FILE_READ_ERROR);
  }
}

/**
 * バイト数を「1.5 MiB」の形にする。
 *
 * @remarks
 * 1024 を基準にするため、単位は KiB・MiB・GiB と書く（KB・MB は 1000 を基準にした単位で、値が食い違うため）。
 * 文字数（UTF-16 の単位）には使わない。
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}
