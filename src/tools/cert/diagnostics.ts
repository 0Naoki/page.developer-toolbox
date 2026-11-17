import { parseItem, type Certificate } from './logic';
import type { DerItem } from './pem';
import { errorMessage } from '../../lib/errors';

type Card = { index: number } & (
  { ok: true; item: ReturnType<typeof parseItem> } | { ok: false; error: string }
);

/**
 * 全件を解析し、証明書の順序とカードの元の番号を保ったままエラー表示を制限する。
 *
 * @remarks
 * チェーンの診断（checkChain）の文言をカードの「n 枚目」と同じ番号にするため、読めた証明書ごとの入力の中の位置（certPositions）と、
 * 読めなかったブロックの位置（unreadable。表示を省いたものも含む）も返す。
 */
export function diagnoseItems(items: DerItem[]) {
  const maxErrors = 5;
  const certs: Certificate[] = [];
  const certPositions: number[] = [];
  const unreadable: number[] = [];
  const cards = items.flatMap<Card>((entry, index) => {
    try {
      const item = parseItem(entry);
      if (item.kind === 'certificate') {
        certs.push(item);
        certPositions.push(index);
      }
      return [{ index, ok: true, item }];
    } catch (error) {
      unreadable.push(index);
      return unreadable.length <= maxErrors ? [{ index, ok: false, error: errorMessage(error) }] : [];
    }
  });
  return { cards, certs, certPositions, unreadable, total: items.length, errorCount: unreadable.length, maxErrors };
}
