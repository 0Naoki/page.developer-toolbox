/** コピーした内容の記録（OS のクリップボードは変えない） */
import type { Page } from '@playwright/test';

type ClipboardWindow = Window & { __copiedText?: string };

/**
 * ページの中の navigator.clipboard.writeText を差し替え、コピーした全文を記録する（OS のクリップボードは変えない）。
 * 読み込みの前に呼ぶと、再読み込みの後も記録を続ける。読み込んだ後に呼んだ場合は、今のページにも差し替えを入れる。
 * 記録は copiedText・copiedLength・copiedLines で読む
 */
export async function captureClipboard(page: Page): Promise<void> {
  const install = () => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => { (window as ClipboardWindow).__copiedText = text; },
    });
  };
  await page.addInitScript(install);
  if (page.url() !== 'about:blank') await page.evaluate(install);
}

/** 最後にコピーした全文（まだコピーしていなければ null）。長いテキストは copiedLength・copiedLines を使う */
export const copiedText = (page: Page): Promise<string | null> =>
  page.evaluate(() => (window as ClipboardWindow).__copiedText ?? null);

/** 最後にコピーしたテキストの長さ（UTF-16単位）。全文をテストへ渡さずに、ページの中で数える */
export const copiedLength = (page: Page): Promise<number | null> =>
  page.evaluate(() => (window as ClipboardWindow).__copiedText?.length ?? null);

/** 最後にコピーしたテキストの行数（LF で数える） */
export const copiedLines = (page: Page): Promise<number | null> =>
  page.evaluate(() => (window as ClipboardWindow).__copiedText?.split('\n').length ?? null);
