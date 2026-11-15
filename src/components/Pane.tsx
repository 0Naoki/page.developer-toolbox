import type { ReactNode } from 'react';

/**
 * 見出しの付いた入力・出力の欄（`pane`）。見出しの右に、コピー・保存・クリアなどの操作を並べる。
 *
 * @remarks
 * 見出しと中身の間の余白は `.pane` の gap で決める（部品の側にマージンを足さない）。
 *
 * @param title - 欄の見出し。省略すると見出しの行を置かない（見出しを中の部品が持つ出力など）。
 * @param actions - 見出しの右に並べる操作。
 */
export function Pane({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="pane">
      {title !== undefined && (
        <div className="pane-head">
          {title}
          {actions ? <span className="pane-actions">{actions}</span> : null}
        </div>
      )}
      {children}
    </div>
  );
}
