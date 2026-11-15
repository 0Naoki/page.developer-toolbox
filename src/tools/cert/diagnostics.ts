import { parseItem, type Certificate } from './logic';
import type { DerItem } from './pem';
import { errorMessage } from '../../lib/errors';

type Card = { index: number } & (
  { ok: true; item: ReturnType<typeof parseItem> } | { ok: false; error: string }
);

/** 全件を解析し、証明書の順序とカードの元の番号を保ったままエラー表示を制限する。 */
export function diagnoseItems(items: DerItem[]) {
  const maxErrors = 5;
  const certs: Certificate[] = [];
  let errorCount = 0;
  const cards = items.flatMap<Card>((entry, index) => {
    try {
      const item = parseItem(entry);
      if (item.kind === 'certificate') certs.push(item);
      return [{ index, ok: true, item }];
    } catch (error) {
      errorCount++;
      return errorCount <= maxErrors ? [{ index, ok: false, error: errorMessage(error) }] : [];
    }
  });
  return { cards, certs, total: items.length, errorCount, maxErrors };
}
