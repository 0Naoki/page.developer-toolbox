import type { ReactNode } from 'react';

/**
 * 見出し付きのチェックボックス。見出しの文字をクリックしても切り替わり、読み上げソフトには見出しが名前として伝わる。
 *
 * @param label - チェックボックスの見出し（読み上げ用の名前にもなる）。
 * @param onChange - 切り替えたときに、新しい状態（チェックされているか）を受け取る。
 * @param small - 小さな文字で、ほかの部品の横に添えるときに使う。
 * @param title - マウスを乗せたときに出す補足。
 */
export function Check({ label, checked, onChange, small = false, title }: {
  label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; small?: boolean; title?: string;
}) {
  return (
    <label className={small ? 'check small' : 'check'} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
