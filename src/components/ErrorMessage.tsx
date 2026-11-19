import type { ReactNode } from 'react';
import { limitMessage } from '../lib/text/textPreview';
import { useAnnounce } from './LiveAnnouncer';

/**
 * 1行のエラー（`error-text`）。文言は `MESSAGE_LIMIT`（`src/lib/text/textPreview.ts`）までに制限して描画する。
 *
 * @param message - 表示する文言。入力を含んでもよい。
 * @param as - 包む要素。段落の中に置くときは span にする。
 * @param alert - 読み上げソフトにすぐ伝える（role="alert"）。指定しないときは、入力が止まってから共通の読み上げの領域（LiveAnnouncer）で読む。
 */
export function ErrorText({ message, as: Tag = 'p', alert = false }: { message: string; as?: 'p' | 'span'; alert?: boolean }) {
  useAnnounce(alert ? null : `エラー：${message}`);
  return <Tag className="error-text" role={alert ? 'alert' : undefined}>{limitMessage(message)}</Tag>;
}

/**
 * 見出し付きのエラー（`error-box`）。文字列で渡す message と detail は `MESSAGE_LIMIT`（`src/lib/text/textPreview.ts`）までに制限して描画する。
 *
 * @remarks
 * 入力を含み得る文言は、必ず message か detail で渡す。children には、ボタンや固定の文言など入力を含まないものだけを置く。
 *
 * @param title - 先頭の太字の見出し。
 * @param detail - 見出しの後に置く補足（位置など）。
 * @param message - エラーの文言。
 * @param code - message を等幅（code）で表示する。
 * @param alert - 読み上げソフトにすぐ伝える（role="alert"）。指定しないときは、入力が止まってから共通の読み上げの領域（LiveAnnouncer）で読む。
 */
export function ErrorBox({ title, detail, message, code = false, alert = false, children }: {
  title?: ReactNode; detail?: string; message?: string; code?: boolean; alert?: boolean; children?: ReactNode;
}) {
  const shown = message === undefined ? null : limitMessage(message);
  /** 見出しが文字列なら、見出しと文言を続けて読む */
  useAnnounce(alert ? null : ['エラー', typeof title === 'string' ? title : null, message].filter(Boolean).join('：'));
  return (
    <div className="error-box" role={alert ? 'alert' : undefined}>
      {title !== undefined && <strong>{title}</strong>}
      {detail !== undefined && <span>{limitMessage(detail)}</span>}
      {shown !== null && (code ? <code>{shown}</code> : <span>{shown}</span>)}
      {children}
    </div>
  );
}
