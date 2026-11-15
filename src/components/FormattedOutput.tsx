import { CopyButton } from './CopyButton';
import { downloadText } from '../lib/file';
import { TEXT_PREVIEW_LIMIT, TEXT_PREVIEW_LIMIT_LABEL, textPreview } from '../lib/text/textPreview';

/** 大きな結果の表示だけを制限し、コピーと保存には全文を渡す。 */
export function FormattedOutput({ text, filename, mime }: { text: string; filename: string; mime: string }) {
  return (
    <>
      <div className="pane-head">
        出力
        <CopyButton text={text} />
        <button type="button" className="btn btn-ghost" disabled={!text} onClick={() => downloadText(filename, text, mime)}>全文を保存</button>
      </div>
      <TextOutputPreview label="出力" text={text} canSave wrap="off" />
    </>
  );
}

/**
 * 長い出力の表示だけを先頭までに切り詰め、切り詰めたときは出力の前に案内を出す。呼び出し側のコピー・保存は元の text を使う。
 *
 * @remarks
 * ツールの画面は、長くなり得る出力をこの部品で表示する（textPreview を画面で直接呼ばない。静的検査あり）。
 * 案内の文言と位置をツール間でそろえるため。
 *
 * @param as 読み取り専用の入力欄（textarea）か、整形済みのテキスト（pre）か
 */
export function TextOutputPreview({ label, text, canSave = false, wrap, as = 'textarea', className }: {
  label: string;
  text: string;
  canSave?: boolean;
  wrap?: 'off';
  as?: 'textarea' | 'pre';
  className?: string;
}) {
  const shown = textPreview(text, TEXT_PREVIEW_LIMIT);
  return (
    <>
      {text.length > TEXT_PREVIEW_LIMIT && (
        <p className="hint">画面は先頭{TEXT_PREVIEW_LIMIT_LABEL}文字相当までの表示です。{canSave ? 'コピー・保存' : 'コピー'}は全文を対象にします。</p>
      )}
      {as === 'pre' ? (
        <pre className={className ?? 'code code-pre'} aria-label={label} role="region" tabIndex={0}>{shown}</pre>
      ) : (
        <textarea aria-label={label} className={className ?? 'code'} readOnly spellCheck={false} wrap={wrap} value={shown} />
      )}
    </>
  );
}
