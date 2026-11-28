/** ファイルの選択と、保存（ダウンロード）したファイルの読み取り */
import type { Download, Page } from '@playwright/test';

/**
 * ファイル入力に渡すファイルの中身。大きなファイルはテストの外に作らず、ページの中で作る。
 * - 文字列：UTF-8 のテキスト
 * - 数値の配列：そのままのバイト列
 * - { zeros }：その長さの 0 のバイト列
 * - { repeat, bytes }：repeat を繰り返し、bytes 文字で切ったテキスト
 */
export type FileContents = string | number[] | { zeros: number } | { repeat: string; bytes: number };

/** 画面のファイル入力（input[type=file]）でファイルを選んだときと同じように、ファイルを1つ渡す */
export async function pickFile(page: Page, name: string, contents: FileContents, type = ''): Promise<void> {
  await page.locator('input[type=file]').evaluate((input: HTMLInputElement, { name, contents, type }) => {
    const body = typeof contents === 'string' ? contents
      : Array.isArray(contents) ? new Uint8Array(contents)
      : 'zeros' in contents ? new Uint8Array(contents.zeros)
      : contents.repeat.repeat(Math.ceil(contents.bytes / contents.repeat.length)).slice(0, contents.bytes);
    const transfer = new DataTransfer();
    transfer.items.add(new File([body], name, { type }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, contents, type });
}

export async function downloadedText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('ダウンロード結果を読み取れません');
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}
