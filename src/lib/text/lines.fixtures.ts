/** テスト用のデータ（画面からは読み込まない） */

/**
 * 改行の形式ごとの入力と、期待する行。行を扱う処理（営業日の独自休日・サブネットの一覧・PEM など）の
 * テストでも、この組み合わせで確かめる
 */
export const LINE_BREAK_CASES: { name: string; text: string; lines: string[] }[] = [
  { name: 'LF', text: 'a\nb\nc', lines: ['a', 'b', 'c'] },
  { name: 'CRLF', text: 'a\r\nb\r\nc', lines: ['a', 'b', 'c'] },
  { name: 'CR', text: 'a\rb\rc', lines: ['a', 'b', 'c'] },
  { name: '混在', text: 'a\r\nb\rc\nd', lines: ['a', 'b', 'c', 'd'] },
  { name: '空の行（CR の連続と CRLF の後の LF）', text: 'a\r\rb\r\n\nc', lines: ['a', '', 'b', '', 'c'] },
  { name: '末尾の改行', text: 'a\r\n', lines: ['a', ''] },
];

/** LINE_BREAK_CASES の a〜d を、各処理の入力の値に置き換える（改行はそのまま残す） */
export const withValues = (text: string, values: Record<'a' | 'b' | 'c' | 'd', string>) =>
  text.replace(/[a-d]/g, (letter) => values[letter as 'a' | 'b' | 'c' | 'd']);
