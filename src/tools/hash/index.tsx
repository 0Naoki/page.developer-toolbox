/**
 * ハッシュ生成のファイルの分担。
 * - `logic.ts`：ハッシュ・HMAC・MD5 の計算と入力の検査
 * - `computeHashes.ts`：入力ごとの全アルゴリズムの計算、中断確認、進捗報告
 */
import { useMemo, useState } from 'react';
import { Pane } from '../../components/Pane';
import { Badge } from '../../components/Badge';
import { useAsyncFor } from '../../hooks/useAsyncFor';
import { Notice } from '../../components/Notice';
import { CopyButton } from '../../components/CopyButton';
import { FileDrop } from '../../components/FileDrop';
import { LargeTextInput } from '../../components/LargeTextInput';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { fileTooLargeMessage, formatBytes } from '../../lib/file';
import { MAX_FILE, WEAK_ALGORITHMS, sameHash, surrogateWarning } from './logic';
import { ErrorBox } from '../../components/ErrorMessage';
import { errorMessage } from '../../lib/errors';
import { Check } from '../../components/Check';

import { computeHashes, type HashInput, type HashResult, type Row } from './computeHashes';

type Source = 'text' | 'file';
type OutputFormat = 'hex' | 'HEX' | 'base64';

/** サンプルの入力（架空の値） */
const SAMPLE = 'Hello, Dev Toolbox!';

export default function HashTool() {
  /** 入力値・鍵は機密になり得るため保存しない */
  const [source, setSource] = usePreference<Source>('hash:source', 'text', oneOf('text', 'file'));
  const [format, setFormat] = usePreference<OutputFormat>('hash:format', 'hex', oneOf('hex', 'HEX', 'base64'));
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [useHmac, setUseHmac] = useState(false);
  const [key, setKey] = useState('');
  const [expected, setExpected] = useState('');
  const [fileError, setFileError] = useState('');

  const needsKey = useHmac && key === '';
  const input = useMemo((): HashInput | null => {
    if (needsKey) return null;
    if (source === 'file') return file ? { source, file, useHmac, key } : null;
    return text !== '' ? { source, text, useHmac, key } : null;
  }, [source, text, file, useHmac, key, needsKey]);
  const hasInput = input !== null;
  /**
   * 結果と進捗は input と組にして持ち、入力・鍵・方式・ファイルが変わった描画から、古い結果を照合やコピーへ渡さない。
   * テキストと HMAC の鍵は、打ち終わるまで少し待ってから計算する
   * （ファイルの HMAC では、計算のたびにファイル全体（最大 MAX_FILE）を読み直すため、鍵の1文字ごとに読み込みを重ねない）
   */
  const evaluation = useAsyncFor<HashInput, HashResult, number>(
    input,
    computeHashes,
    (e) => ({ rows: [], error: errorMessage(e) }),
    { delay: source === 'text' || useHmac ? 150 : 0 },
  );
  const rows = evaluation.ready ? evaluation.value.rows : [];
  const busy = hasInput && !evaluation.ready;
  const progress = evaluation.ready ? null : evaluation.progress;
  const error = evaluation.ready ? evaluation.value.error : '';
  const textWarning = source === 'text' && rows.length > 0 ? surrogateWarning(text) : null;

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE) {
      /**
       * 前のファイルの名前と結果が残ると、選び直したファイルの結果と見間違えるため、選択ごと消す。
       * 計算のたびに消える error とは別に持つ（ファイルを消すと計算処理が走り、error を空にするため）
       */
      setFile(null);
      setFileError(fileTooLargeMessage(MAX_FILE));
      return;
    }
    setFileError('');
    setFile(f);
  };

  const shown = (r: Row) => (format === 'base64' ? r.base64 : format === 'HEX' ? r.hex.toUpperCase() : r.hex);
  const matched = expected.trim() ? rows.find((r) => sameHash(expected, r.hex, r.base64)) : undefined;

  return (
    <ToolShell
      description="SHA系は Web Crypto API、MD5 は自前実装で計算します。ファイルも外部に送信されません。"
    >
      <div className="toolbar">
        <button type="button" className="btn btn-ghost" onClick={() => {
          setSource('text');
          setText(SAMPLE);
        }}>
          サンプル
        </button>
        <Segmented<Source>
          label="入力"
          value={source}
          onChange={setSource}
          options={[
            { value: 'text', label: 'テキスト' },
            { value: 'file', label: 'ファイル' },
          ]}
        />
        <Segmented<OutputFormat>
          label="出力形式"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'hex', label: 'hex' },
            { value: 'HEX', label: 'HEX' },
            { value: 'base64', label: 'Base64' },
          ]}
        />
        <Check label="HMAC" checked={useHmac} onChange={setUseHmac} />
      </div>

      {useHmac && (
        <label className="field narrow">
          <span className="field-label">秘密鍵（UTF-8として扱います。保存されません）</span>
          <input className="input mono" value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
      )}

      {source === 'text' ? (
        <Pane title="テキスト（UTF-8）">
          {/** 長いテキストを普通の textarea で描画すると画面が止まるため、表示を先頭までにする。ハッシュは改行の違いで変わるため、元の改行を保つ */}
          <LargeTextInput label="テキスト（UTF-8）" className="code code-mid" value={text} onChange={setText} preserveLineEndings />
        </Pane>
      ) : (
        <FileDrop onFile={pickFile}>
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span className="muted">{formatBytes(file.size)}　（クリックまたはドロップで変更）</span>
            </>
          ) : (
            <>
              <strong>ファイルをドロップ</strong>
              <span className="muted">またはクリックして選択（ダウンロードしたファイルのチェックサム確認などに）</span>
            </>
          )}
        </FileDrop>
      )}

      <label className="field">
        <span className="field-label">照合（期待するハッシュ値を貼り付け）</span>
        <input
          className="input mono"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="例: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
          spellCheck={false}
        />
      </label>
      {expected.trim() && rows.length > 0 && (
        <Notice tone={matched ? 'good' : 'bad'} role="status" message={matched ? `✓ ${matched.algorithm} の値と一致しました` : '✗ どのアルゴリズムの値とも一致しません'} />
      )}

      {needsKey && <Notice tone="warn">HMAC の秘密鍵を入力してください</Notice>}
      {textWarning && <Notice tone="warn" message={textWarning} />}
      {busy && (
        <Notice role="status">
          計算中…{progress !== null && ` ${Math.round(progress * 100)}%`}
          {progress !== null && (
            <div className="meter" aria-hidden="true">
              <div className="meter-fill lv3" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </Notice>
      )}

      {source === 'file' && fileError && (
        <ErrorBox title="ファイルを読み込めません" message={fileError} />
      )}
      {error && (
        <ErrorBox title="計算できません" message={error} />
      )}

      <table className="kv hash-table" aria-busy={busy}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.algorithm} className={matched?.algorithm === r.algorithm ? 'match' : undefined}>
              <th>
                {useHmac ? `HMAC-${r.algorithm}` : r.algorithm}
                {WEAK_ALGORITHMS.includes(r.algorithm) && <Badge small>非推奨</Badge>}
              </th>
              <td className="mono hash-value">{shown(r)}</td>
              <td className="right">
                <CopyButton text={shown(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        MD5 と SHA-1 は衝突攻撃が知られているため、改ざん検知や署名には SHA-256 以上を使ってください。パスワードの保存には、ハッシュではなく bcrypt や Argon2 などの専用方式を使います。
      </p>
    </ToolShell>
  );
}
