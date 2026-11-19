/**
 * Base64 / URLエンコードのファイルの分担。
 * - `logic.ts`：テキストの変換（Base64・Base64URL・URLエンコード）、data: URI、16進ダンプ、上限
 * - `conversion.ts`：形式ごとの設定の適用と、ファイルのエンコード
 * - `presentation.ts`：文字コード・ダンプ表示・全文のコピーと入れ替えの可否・保存するファイル名の判定（純粋関数）
 * - `useBase64File.ts`：最後に選んだファイルの読み込み（useFileLoader）
 * - `useBase64Conversion.ts`：同期の変換と Worker の変換の選択
 * 表示形式の切り替えでは、Base64 の復号と文字コードの変換をやり直さない。
 */
import { useMemo } from 'react';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { Pane } from '../../components/Pane';
import { Badge } from '../../components/Badge';
import { Check } from '../../components/Check';
import { Notice } from '../../components/Notice';
import { CalculationStatus } from '../../components/CalculationStatus';
import { CopyButton } from '../../components/CopyButton';
import { FileDrop } from '../../components/FileDrop';
import { LargeTextInput } from '../../components/LargeTextInput';
import { Segmented } from '../../components/Segmented';
import { detailPreview } from '../../lib/text/textPreview';
import { ToolShell } from '../../components/ToolShell';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { isBoolean, oneOf } from '../../lib/settings';
import { downloadBytes, formatByteLimit, formatBytes } from '../../lib/file';
import { ErrorBox, ErrorText } from '../../components/ErrorMessage';
import { TextOutputPreview } from '../../components/FormattedOutput';
import {
  HEX_DUMP_MAX,
  MAX_FILE,
  type Charset,
  type EncodeMode,
} from './logic';

import { type Direction, type Source } from './conversion';
import { decodedResultText, presentResult, savedFileOf, type View } from './presentation';
import { useBase64File } from './useBase64File';
import { OpenInToolButton } from '../../components/OpenInToolButton';
import { useBase64Conversion } from './useBase64Conversion';

const MODES: { value: EncodeMode; label: string }[] = [
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
  { value: 'url', label: 'URLエンコード' },
];

const CHARSETS: { value: Charset; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'shift_jis', label: 'Shift_JIS' },
  { value: 'euc-jp', label: 'EUC-JP' },
  { value: 'utf-16le', label: 'UTF-16LE' },
];

/** サンプルの入力（日本語・記号・URL を含む、架空の値） */
const SAMPLE = 'こんにちは、Dev Toolbox! https://example.com/search?q=日本語&page=2';

export default function Base64Tool() {
  const [input, setInput] = useInput('base64');
  const [mode, setMode] = usePreference<EncodeMode>('base64:mode', 'base64', oneOf(...MODES.map(({ value }) => value)));
  const [direction, setDirection] = usePreference<Direction>('base64:dir', 'encode', oneOf('encode', 'decode'));
  const [source, setSource] = usePreference<Source>('base64:source', 'text', oneOf('text', 'file'));
  const [wrap, setWrap] = usePreference('base64:wrap', false, isBoolean);
  const [asDataUri, setAsDataUri] = usePreference('base64:datauri', false, isBoolean);
  const [charset, setCharset] = usePreference<Charset>('base64:charset', 'utf-8', oneOf(...CHARSETS.map(({ value }) => value)));
  const [view, setView] = usePreference<View>('base64:view', 'text', oneOf('text', 'hex'));
  const { file, fileError, fileLoading, pickFile } = useBase64File();
  const { fromFile, dataUri, large, calculation, result } = useBase64Conversion(input, file, { mode, direction, source, wrap, asDataUri });
  /** 表示形式の切り替えだけでは文字列を復号し直さない。 */
  const decodedText = useMemo(() => decodedResultText(result, charset), [result, charset]);
  const { sniffed, showHex, dump, outputText, swapTooLarge, canSwap } = useMemo(
    () => presentResult(result, decodedText, view, fromFile), [result, decodedText, view, fromFile],
  );

  /** 長い入力の計算中は出力がまだないため、入れ替えると方向だけが変わり、元の入力を逆向きに変換してしまう（ボタンを無効にする） */
  const swap = () => {
    if (!canSwap) return;
    setInput(outputText);
    /** 移したテキストをエンコードするので、保存されているファイル入力の設定に関係なく入力元をテキストにする */
    if (direction === 'decode') setSource('text');
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  };

  const save = () => {
    if (result.kind !== 'bytes') return;
    const file = savedFileOf(result.mime, sniffed);
    downloadBytes(file.filename, result.bytes, file.mime);
  };

  return (
    <ToolShell
      description="UTF-8として変換するので、日本語もそのまま扱えます。ファイルのエンコードと、画像などテキストでないデータのデコード（16進ダンプ・ファイルに保存）もできます。選んだファイルは保存しません。"
    >
      <div className="toolbar">
        <Segmented<EncodeMode> label="形式" value={mode} onChange={setMode} options={MODES} />
        <Segmented<Direction>
          label="方向"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'encode', label: 'エンコード' },
            { value: 'decode', label: 'デコード' },
          ]}
        />
        <button type="button" className="btn btn-ghost" onClick={swap} disabled={!canSwap} title="出力を入力に移して方向を反転">
          ⇄ 入れ替え
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => {
          /** どの形式でも読めるよう、テキストのエンコードにして入れる（「⇄ 入れ替え」でデコードも試せる） */
          setSource('text');
          setDirection('encode');
          setInput(SAMPLE);
        }}>
          サンプル
        </button>
        {swapTooLarge && !fromFile && <span className="hint">変換結果が逆方向の入力上限を超えています</span>}
      </div>

      {/** 中身がないときに余白だけが残らないよう、行ごと出し分ける */}
      {((direction === 'encode' && mode !== 'url') || result.kind === 'bytes') && (
        <div className="toolbar">
          {direction === 'encode' && mode !== 'url' && (
            <Segmented<Source>
              label="入力"
              value={source}
              onChange={setSource}
              options={[
                { value: 'text', label: 'テキスト' },
                { value: 'file', label: 'ファイル' },
              ]}
            />
          )}
          {fromFile && mode === 'base64' && (
            <Check label="data: URI の形にする" checked={asDataUri} onChange={setAsDataUri} />
          )}
          {direction === 'encode' && mode === 'base64' && !dataUri && (
            <Check label="76文字ごとに改行（MIME）" checked={wrap} onChange={setWrap} />
          )}
          {result.kind === 'bytes' && (
            <>
              <Segmented<View>
                label="表示"
                value={view}
                onChange={setView}
                options={[
                  { value: 'text', label: 'テキスト' },
                  { value: 'hex', label: '16進ダンプ' },
                ]}
              />
              {view === 'text' && <Segmented<Charset> label="文字コード" value={charset} onChange={setCharset} options={CHARSETS} />}
            </>
          )}
        </div>
      )}

      {large && <CalculationStatus {...calculation} />}

      {result.kind === 'bytes' && (
        <div className="status-row">
          <Badge>{formatBytes(result.bytes.length)}</Badge>
          <Badge>{result.variant}</Badge>
          {/** data: URI の MIME タイプは入力由来で長さに制限がないため、表示は抜粋にする（ダウンロードには元の値を使う） */}
          {result.mime && <Badge>{detailPreview(result.mime)}</Badge>}
          {sniffed && <Badge>{sniffed.label}</Badge>}
        </div>
      )}

      <div className="split">
        <Pane title="入力">
          {fromFile ? (
            <>
              <FileDrop onFile={(f) => void pickFile(f)}>
                {file ? (
                  <>
                    <strong>{file.name}</strong>
                    <span className="muted">{formatBytes(file.bytes.length)}　（クリックまたはドロップで変更）</span>
                  </>
                ) : (
                  <>
                    <strong>ファイルをドロップ</strong>
                    <span className="muted">またはクリックして選択（{formatByteLimit(MAX_FILE)} まで）</span>
                  </>
                )}
              </FileDrop>
              {fileLoading && <p role="status">ファイルを読み込み中…</p>}
              {fileError && <ErrorText message={fileError} />}
            </>
          ) : (
            /**
             * 長いテキストをそのまま textarea に描画すると、90万単位で約1秒止まるため、表示を先頭までにする部品を使う。
             * エンコードでは CRLF と LF で結果が変わるため、元の改行を保つ
             */
            <LargeTextInput limit={MAX_CALCULATION_INPUT}
              label="入力"
              value={input}
              onChange={setInput}
              preserveLineEndings
              placeholder={direction === 'decode' && mode !== 'url' ? 'Base64、または data: URI（data:image/png;base64,...）' : undefined}
            />
          )}
        </Pane>
        <Pane
          title="出力"
          actions={<>
            {result.kind === 'bytes' && (
              <button type="button" className="btn btn-ghost" onClick={save}>
                ファイルに保存
              </button>
            )}
            {/** 16進ダンプは表示と同じ先頭 HEX_DUMP_MAX までを作るため、コピーも表示中の範囲になる。全体は「ファイルに保存」で取り出す */}
            {!showHex && direction === 'decode' && <OpenInToolButton to="json" text={outputText} limit={MAX_CALCULATION_INPUT} />}
            <CopyButton text={showHex ? dump : outputText} label={showHex ? '表示中のダンプをコピー' : 'コピー'} />
          </>}
        >
          {result.kind === 'error' ? (
            <ErrorBox title="変換できません" message={result.error} code />
          ) : showHex ? (
            <>
              {view === 'text' && (
                <Notice>
                  {CHARSETS.find((c) => c.value === charset)!.label} のテキストとして読めないため、16進ダンプで表示しています
                </Notice>
              )}
              {result.kind === 'bytes' && result.bytes.length > HEX_DUMP_MAX && (
                <Notice>先頭 {formatBytes(HEX_DUMP_MAX)} だけ表示しています（コピーも表示中の範囲です）。全体は「ファイルに保存」で確かめられます</Notice>
              )}
              {/** 横にスクロールするため、キーボードでも動かせるようにする */}
              <pre className="code code-pre hexdump" role="region" aria-label="16進ダンプ" tabIndex={0}>
                {dump}
              </pre>
            </>
          ) : (
            <>
              {result.kind === 'text' && result.warning && <Notice tone="warn" message={result.warning} />}
              {/** 長い出力を丸ごと描画すると画面が止まるため、表示は先頭だけにする。コピー・入れ替えは全文を対象にする */}
              <TextOutputPreview label="出力" text={outputText} />
            </>
          )}
        </Pane>
      </div>
    </ToolShell>
  );
}
