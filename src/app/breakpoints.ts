/**
 * 画面幅の切り替えの値（px）。CSS の `@media (max-width: …)` と、JavaScript の matchMedia で同じ値を使う。
 *
 * @remarks
 * `@media` の条件には CSS の変数（var()）を書けないため、CSS には数を直接書き、
 * src/styles.classes.test.ts でこの値と照らし合わせる（CSS で使う切り替えの幅は、ここにあるものだけにする）。
 */
export const BREAKPOINTS = {
  /** これ以下の幅では、サイドバーをメニューにたたむ（スマートフォン） */
  menu: 760,
  /** これ以下の幅では、2列の並びを1列にする */
  columns: 960,
} as const;

/** サイドバーを常に表示する幅（メニューにたたまない幅）か */
export const SIDEBAR_SHOWN_QUERY = `(min-width: ${BREAKPOINTS.menu + 1}px)`;
