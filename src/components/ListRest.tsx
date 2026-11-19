import { CopyButton } from './CopyButton';
import { formatNumber } from '../lib/number';

/**
 * 上限を超えた一覧の、表示しない残りの件数と、全件のコピー。
 * 一覧は previewList（src/lib/listPreview.ts）で先頭だけを描画し、その直後に置く
 */
export function ListRest({ rest, shown, copyText, copyLabel }: { rest: number; shown: number; copyText?: string | (() => string); copyLabel?: string }) {
  if (rest <= 0) return null;
  return (
    <div className="muted">
      ほか {formatNumber(rest)} 件（先頭 {formatNumber(shown)} 件を表示）
      {copyText !== undefined && <CopyButton text={copyText} label={copyLabel} />}
    </div>
  );
}
