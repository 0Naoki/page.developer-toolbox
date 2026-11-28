/**
 * 文字数・バイト数のファイルの分担。
 * - `encoding.ts`：文字コード（Shift_JIS・EUC-JP など）の判定とバイト数
 * - `count.ts`：文字数・バイト数の集計
 * - `issues.ts`：診断の総種類数と表示用の詳細。全件取得時は選んだ診断だけを収集
 * - `reports.ts`：全件診断のTSV出力（上限付き）
 * - `reportText.ts`：出力予算の検査と、一定量ずつの文字列化
 * - `DiagnosticOutput.tsx`：操作時にWorkerで全件を準備し、コピー・保存
 * - `invisible.ts`：不可視文字の検査と、ファイルの読み取り
 * - `characterDetails.ts`：文字のコードポイントの表記と、一覧の件数・入力欄・文字の形の表示上限
 * - `logic.ts`：Worker から呼ぶ測定処理と、行別の結果のページ分割
 * - `useTextCount.ts`：画面の状態（入力・表示設定・ファイルの読み込み・ページ）と計算の結果をまとめるフック
 * - `InvisibleCharacters.tsx`：不可視文字の表示
 */
import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { Notice } from '../../components/Notice';
import { CalculationStatus } from '../../components/CalculationStatus';
import { LargeTextInput } from '../../components/LargeTextInput';
import { FileDrop } from '../../components/FileDrop';
import { Segmented } from '../../components/Segmented';
import { Stat } from '../../components/Stat';
import { ToolShell } from '../../components/ToolShell';
import { InvisibleCharacters } from './InvisibleCharacters';
import { countInputPreviewLimit, ISSUE_GLYPH_PREVIEW, MAX_LISTED } from './characterDetails';
import type { Newline } from './count';
import type { CharIssue, IssueKind } from './issues';
import { DiagnosticOutput } from './DiagnosticOutput';
import { MEASURES, LINE_PAGE_SIZE, type Measure, type Segment } from './logic';
import { useTextCount, type View } from './useTextCount';
import { ErrorText, ErrorBox } from '../../components/ErrorMessage';
import { formatNumber } from '../../lib/number';
import { Check } from '../../components/Check';

export default function TextCount() {
  const {
    text, replaceInput, resetInput, inputRevision, fileLoader,
    newline, setNewline, measure, setMeasure, limitText, setLimitText, limit, invalidLimit,
    onlyOver, setOnlyOver, view, setView, page, setPage, calculation, analysis,
  } = useTextCount();
  const r = analysis?.counts;
  const overCount = analysis?.overCount ?? 0;
  /** 上限が空のときは「超過行だけ表示」の切り替え自体を出さないので、絞り込みもしない */
  const filtering = onlyOver && limit !== null;
  const visible = analysis?.visible ?? [];
  const measureInfo = MEASURES.find((m) => m.value === measure)!;

  return (
    <ToolShell
      description="帳票の桁数、DB項目の長さ、固定長ファイルの確認に。Shift_JIS は Windows-31J（CP932）として計算します。"
    >
      <div className="toolbar">
        <Segmented<View>
          label="表示する内容"
          value={view}
          onChange={setView}
          options={[
            { value: 'counts', label: '文字数' },
            { value: 'invisible', label: '不可視文字' },
            { value: 'lines', label: '桁あふれ' },
          ]}
        />
        <button type="button" className="btn btn-ghost" onClick={() => resetInput('')}>
          クリア
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => { resetInput('通常の空白 と全角　\tタブ\r\nNBSP:\u00a0 ゼロ幅:\u200b\nBOM:\ufeff 方向制御:\u202e\r絵文字:👨\u200d👩\u200d👧'); setView('invisible'); }}>
          不可視文字のサンプル
        </button>
      </div>

      <LargeTextInput limit={MAX_CALCULATION_INPUT} previewLimit={countInputPreviewLimit(text)}
        label="テキスト"
        className="code code-mid"
        value={text}
        onChange={replaceInput}
        preserveLineEndings
        resetKey={inputRevision}
        placeholder="ここにテキストを貼り付け"
      />
      <FileDrop small onFile={(file) => { void fileLoader.pick(file); }}>
        UTF-8ファイルを読み込む（改行・BOMを保持）
      </FileDrop>
      <p className="hint">貼り付けた文字列の改行を保持して検査します。元ファイルの正確な改行・BOMを確認するには、UTF-8ファイルを読み込んでください。Enterは通常LFですが、直前のCRとの結合を防ぐ場合はCRまたはCRLFを追加します。編集履歴はメモリ内だけに保持します。</p>
      {fileLoader.loading && <p className="hint">ファイルを読み込み中…</p>}
      {fileLoader.error && <ErrorBox alert message={fileLoader.error} />}

      <CalculationStatus {...calculation} />
      {view === 'counts' && <section className="stack" aria-label="文字数の結果">
      <h2 className="section-title">文字数・バイト数</h2>
      <div className="toolbar">
        <Segmented<Newline>
          label="改行の数え方" value={newline} onChange={setNewline}
          options={[{ value: 'none', label: '数えない' }, { value: 'lf', label: 'LF（1）' }, { value: 'crlf', label: 'CRLF（2）' }]}
        />
      </div>
      {analysis && r && <>
      <div className="stats">
        <Stat label="文字数" value={formatNumber(r.graphemes)} note="見た目の文字数" />
        <Stat label="Shift_JIS" value={formatNumber(r.sjisBytes)} note="バイト" />
        <Stat label="EUC-JP" value={formatNumber(r.eucjpBytes)} note="バイト" />
        <Stat label="UTF-8" value={formatNumber(r.utf8Bytes)} note="バイト" />
        <Stat label="UTF-16" value={formatNumber(r.utf16Bytes)} note="バイト（BOM なし）" />
        <Stat label="全角 / 半角" value={`${formatNumber(r.fullWidth)} / ${formatNumber(r.halfWidth)}`} note="改行を除く" />
        <Stat label="コードポイント" value={formatNumber(r.codePoints)} note="MySQL・PostgreSQL の文字数" />
        <Stat label="UTF-16 単位" value={formatNumber(r.utf16Units)} note="Java・JavaScript の length" />
        <Stat label="行数" value={formatNumber(r.lines)} />
      </div>

      <CharIssues
        input={text} kind="unsupported" label="Shift_JIS診断"
        tone="bad"
        title="Shift_JIS で表現できない文字があります"
        note="バイト数は2バイトとして概算しています"
        issues={r.unsupported}
        total={analysis.counts.issueTotals.unsupported}
      />
      <CharIssues
        input={text} kind="unsupportedEuc" label="EUC-JP診断"
        tone="bad"
        title="EUC-JP で表現できない文字があります"
        note="バイト数は2バイトとして概算しています"
        issues={r.unsupportedEuc}
        total={analysis.counts.issueTotals.unsupportedEuc}
      />
      <CharIssues
        input={text} kind="vendor" label="機種依存文字の診断"
        tone="warn"
        title="機種依存文字があります"
        note="Shift_JIS（Windows の CP932）では表現できますが、JIS X 0208 だけに対応した環境（ISO-2022-JP のメール、古いシステムなど）では文字化けするおそれがあります"
        issues={r.vendor}
        total={analysis.counts.issueTotals.vendor}
      />
      </>}
      </section>}

      {view === 'invisible' && analysis && <InvisibleCharacters input={text} result={analysis.invisible} />}

      {view === 'lines' && <section className="stack" aria-label="桁あふれの結果">
      <h2 className="section-title">行ごとの長さ（桁あふれチェック）</h2>
      <div className="toolbar">
        <label>
          測り方
          <select value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
            {MEASURES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          上限
          <input
            className="input input-num mono"
            inputMode="numeric"
            placeholder="例: 40"
            aria-invalid={invalidLimit || undefined}
            value={limitText}
            onChange={(e) => setLimitText(e.target.value.replace(/[^\d]/g, ''))}
          />
        </label>
        {limit !== null && (
          <>
            {analysis && <Badge tone={overCount > 0 ? 'bad' : 'good'}>
              {overCount > 0 ? `${formatNumber(overCount)}行が上限超過` : 'すべて上限以内'}
            </Badge>}
            <Check label="超過行だけ表示" checked={onlyOver} onChange={setOnlyOver} />
          </>
        )}
      </div>
      {invalidLimit && <ErrorText alert message={`上限は0〜${formatNumber(Number.MAX_SAFE_INTEGER)}の整数で指定してください。`} />}
      <p className="hint">{measureInfo.hint}</p>

      {analysis && analysis.matchingLines > 0 && (
        <div className="table-scroll">
          <table className="line-table" aria-label="行ごとの長さ">
            <thead>
              <tr>
                <th className="right">行</th>
                <th className="right">{measureInfo.label}</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.no} className={l.over ? 'over' : undefined}>
                  <td className="right mono muted">{l.no}</td>
                  <td className="right mono">
                    {formatNumber(l.value)}
                    {l.over && limit !== null && <span className="over-by">+{formatNumber(l.value - limit)}</span>}
                  </td>
                  <td className="line-text">
                    {l.text ? <LineText text={l.text} segments={l.segments} /> : <span className="muted">（空行）</span>}
                    {l.truncated && <span className="muted">…（表示を省略。長さは全文で計測）</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {filtering ? '上限を超えた行のうち、' : ''}{formatNumber(page * LINE_PAGE_SIZE + 1)}〜{formatNumber(Math.min((page + 1) * LINE_PAGE_SIZE, analysis.matchingLines))}行を表示しています（全 {formatNumber(analysis.matchingLines)} 行）
          </p>
          {analysis.matchingLines > LINE_PAGE_SIZE && <div className="toolbar">
            <button type="button" className="btn btn-ghost" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>前の{LINE_PAGE_SIZE}行</button>
            <button type="button" className="btn btn-ghost" disabled={(page + 1) * LINE_PAGE_SIZE >= analysis.matchingLines} onClick={() => setPage((value) => value + 1)}>次の{LINE_PAGE_SIZE}行</button>
          </div>}
        </div>
      )}
      </section>}
    </ToolShell>
  );
}

function CharIssues({ tone, title, note, issues, total, input, kind, label }: {
  tone: 'bad' | 'warn'; title: string; note: string; issues: CharIssue[]; total: number; input: string; kind: IssueKind; label: string;
}) {
  const [showGlyphs, setShowGlyphs] = useState(false);
  if (issues.length === 0) return null;
  return (
    <Notice tone={tone} className="stack">
      <strong>{title}</strong>（{note}）
      <div className="tag-list">
        {issues.slice(0, MAX_LISTED).map((u, index) => (
          <span key={u.char} className="tag">
            <span className="char-glyph">{showGlyphs || index < ISSUE_GLYPH_PREVIEW ? u.char : '…'}</span>
            <span className="mono muted">
              {u.codePoint}
              {u.count > 1 && ` ×${formatNumber(u.count)}`}
            </span>
            <span className="muted">
              {u.reason && `${u.reason}・`}
              {u.line}行目 {u.column}文字目
            </span>
          </span>
        ))}
      </div>
      {issues.length > ISSUE_GLYPH_PREVIEW && <>
        <p className="hint">文字の形は通常、先頭{ISSUE_GLYPH_PREVIEW}種類を表示します。コードポイント・位置・件数は一覧と全件出力で確認できます。</p>
        <button type="button" className="btn btn-ghost" aria-pressed={showGlyphs} onClick={() => setShowGlyphs((value) => !value)}>
          {showGlyphs ? `${label}の文字の形を先頭だけ表示` : `${label}の文字の形をすべて表示`}
        </button>
      </>}
      {total > MAX_LISTED && <p className="hint">ほか {formatNumber(total - MAX_LISTED)} 種類</p>}
      <DiagnosticOutput input={input} kind={kind} label={label} />
    </Notice>
  );
}

/** 行の内容。Shift_JIS・EUC-JP で測るときは、表現できない文字を強調する */
function LineText({ text, segments }: { text: string; segments?: Segment[] }) {
  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map((s, i) =>
        s.bad ? (
          <mark key={i} className="char-bad" title="選択した文字コードで表現できない文字">
            {s.text}
          </mark>
        ) : (
          s.text
        ),
      )}
    </>
  );
}
