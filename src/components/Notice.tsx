import type { ReactNode } from 'react';
import { limitMessage } from '../lib/text/textPreview';

/** 案内の種類。info は色を付けない案内、good・bad・warn は判定の結果と注意 */
type NoticeTone = 'info' | 'good' | 'bad' | 'warn';

/**
 * 案内・警告・判定の結果（`notice`）。文字列で渡す message は、エラーと同じ上限（`MESSAGE_LIMIT`）までに制限して描画する。
 *
 * @remarks
 * 警告の文言には入力（キー名・アドレスなど）が入ることがある。文言を作る側の抜粋（`detailPreview`）に加えて、表示の側でも上限をかける。
 * 入力を含み得る文言は、必ず message で渡す。children には、ボタン・固定の文言・件数など入力を含まないものだけを置く。
 *
 * @param tone - 案内の種類（色）。
 * @param message - 文言。入力を含んでもよい。children より前に置く。
 * @param role - 読み上げソフトに伝える方法（判定の結果は status）。
 * @param as - 包む要素。段落として置くときは p にする。
 * @param className - 位置などを調整する追加のクラス。
 */
export function Notice({ tone = 'info', message, role, as: Tag = 'div', className, children }: {
  tone?: NoticeTone; message?: string; role?: 'status' | 'alert'; as?: 'div' | 'p'; className?: string; children?: ReactNode;
}) {
  const classes = ['notice', tone === 'info' ? null : tone, className].filter(Boolean).join(' ');
  return (
    <Tag className={classes} role={role}>
      {message !== undefined && limitMessage(message)}
      {children}
    </Tag>
  );
}
