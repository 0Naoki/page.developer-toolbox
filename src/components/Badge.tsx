import type { ReactNode } from 'react';

/** バッジの色。neutral は色を付けない件数・種類、good・bad は判定の結果、add・del は差分の追加・削除 */
export type BadgeTone = 'neutral' | 'good' | 'bad' | 'add' | 'del';

/**
 * 件数・種類・判定の結果を示す小さなラベル（`badge`）。
 *
 * @remarks
 * 入力由来の値（MIME タイプ・alg・発行者名など）を入れるときは、作る側で `detailPreview` を通して抜粋にする。
 *
 * @param tone - 色。
 * @param small - 見出しの横に添える小さなバッジ（「非推奨」「重要」など）にする。
 * @param title - マウスを乗せたときの説明。
 * @param label - 読み上げソフトに伝える名前（表示する文字と違うときだけ）。
 */
export function Badge({ tone = 'neutral', small = false, title, label, children }: {
  tone?: BadgeTone; small?: boolean; title?: string; label?: string; children: ReactNode;
}) {
  const classes = ['badge', tone === 'neutral' ? null : `badge-${tone}`, small ? 'badge-small' : null].filter(Boolean).join(' ');
  return <span className={classes} title={title} aria-label={label}>{children}</span>;
}
