import type { Locator, Page } from '@playwright/test';

/**
 * 入力欄への貼り付けを再現する。selection を渡すと、その範囲（textarea の値での位置）を選択してから貼り付ける。
 * ClipboardEvent の初期化で clipboardData を渡しても、Firefox はスクリプトが作った貼り付けイベントでは
 * その内容を読めないため、作ったイベントに clipboardData を直接設定する（どのブラウザでも同じ動きになる）
 */
export async function paste(target: Locator, text: string, selection?: [number, number]): Promise<void> {
  await target.evaluate(
    (element: HTMLTextAreaElement, [value, range]) => {
      if (range) {
        element.focus();
        element.setSelectionRange(range[0], range[1]);
      }
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', value);
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      element.dispatchEvent(event);
    },
    [text, selection ?? null] as const,
  );
}

/** 画像（テキストを含まないデータ）の貼り付けを再現する。入力欄の全体を選択してから貼り付ける */
export async function pasteImageOverAll(target: Locator): Promise<void> {
  await target.evaluate(async (element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, element.value.length);
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array([0])], 'image.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    element.dispatchEvent(event);
    /** 貼り付けで入力が変わるなら反映されるまで待つ（変わらないことを確かめるため） */
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** 大容量の貼り付けを、OS のクリップボードを変更せずに再現する。 */
export async function pasteLargeInput(page: Page, label: string, text: string) {
  await paste(page.getByRole('textbox', { name: label, exact: true }), text);
}
