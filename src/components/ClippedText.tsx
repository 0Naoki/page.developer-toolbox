import { CopyButton } from './CopyButton';
import { textPreview, VALUE_PREVIEW_LIMIT } from '../lib/text/textPreview';
import { formatNumber } from '../lib/number';

/**
 * 1つの値を、上限までの長さで表示する。上限を超えたら「以降省略」と元の長さを示し、全文のコピーボタンを付ける。
 *
 * @remarks
 * 一覧の件数の上限（ListRest）とは別に、件数が少なくても1つの値が長ければ、ここで全文を取り出せるようにする。
 *
 * @param copy 省略したときに全文のコピーボタンを付けるか（同じ行にすでにコピーボタンがある場合は false）
 */
export function ClippedText({ text, limit = VALUE_PREVIEW_LIMIT, copy = true }: { text: string; limit?: number; copy?: boolean }) {
  if (text.length <= limit) return <>{text}</>;
  return (
    <>
      {textPreview(text, limit)}
      <span className="muted">（以降省略。全{formatNumber(text.length)}文字）</span>
      {copy && <CopyButton text={text} label="全文をコピー" />}
    </>
  );
}
