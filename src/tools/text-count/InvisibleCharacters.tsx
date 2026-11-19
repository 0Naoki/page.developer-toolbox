import { Fragment } from 'react';
import { Badge } from '../../components/Badge';
import { Notice } from '../../components/Notice';
import { Stat } from '../../components/Stat';
import { MAX_LISTED } from './characterDetails';
import { INVISIBLE_PREVIEW_LENGTH, type InvisibleInspection } from './invisible';
import { formatNumber } from '../../lib/number';
import { DiagnosticOutput } from './DiagnosticOutput';

export function InvisibleCharacters({ result, input }: { result: InvisibleInspection; input: string }) {
  return (
    <section className="stack" aria-label="不可視文字検査">
      <h2 className="section-title">不可視文字・改行コードの検査</h2>
      <p className="hint">全文を検査します。位置は1から数えた行とコードポイント単位の文字位置です。行の区切りはCRLF・LF・CRです。検出した文字は自動削除しません。ZWJや異体字セレクタなど、絵文字や言語表記に必要な文字も含みます。</p>
      <div className="stats">
        <Stat label="CRLF" value={formatNumber(result.newlines.crlf)} note="改行の件数" />
        <Stat label="LF" value={formatNumber(result.newlines.lf)} note="CRLFに含まれるLFを除く" />
        <Stat label="CR" value={formatNumber(result.newlines.cr)} note="CRLFに含まれるCRを除く" />
      </div>
      {result.mixedNewlines && <Notice tone="warn" as="p">CRLF・LF・CRのうち、複数の改行コードが混在しています。</Notice>}
      <h3>文字の見える化</h3>
      <p className="hint">表示だけを [SP]・[TAB]・[NBSP]・[ZWSP] などに置き換えます。元の入力は変更しません。</p>
      <pre className="code code-pre invisible-preview" role="region" aria-label="不可視文字の可視化" tabIndex={0}>
        {result.preview.map((part, index) => part.marker ? (
          <Fragment key={index}><Badge title={part.description} label={part.description}>[{part.marker}]</Badge>{part.newline ? '\n' : ''}</Fragment>
        ) : <Fragment key={index}>{part.text}</Fragment>)}
      </pre>
      {result.previewTruncated && <p className="hint">可視化は先頭{formatNumber(INVISIBLE_PREVIEW_LENGTH)}文字相当までです。集計・検出位置は全文を対象にしています。</p>}
      <h3>種類別の集計</h3>
      {result.kindCount === 0 ? <p className="hint">空白・改行・検査対象の不可視文字は見つかりませんでした。</p> : <>
        <div className="table-scroll">
          <table className="line-table" aria-label="不可視文字の種類別集計">
            <thead><tr><th>種類</th><th>コードポイント</th><th className="right">件数</th><th>最初の位置</th></tr></thead>
            <tbody>{result.kinds.map((kind) => <tr key={kind.codePoint}>
              <td><code>[{kind.marker}]</code> {kind.name}</td><td className="mono">{kind.codePoint}</td>
              <td className="right mono">{formatNumber(kind.count)}</td><td>{kind.line}行目 {kind.column}文字目</td>
            </tr>)}</tbody>
          </table>
        </div>
        {result.kindCount > result.kinds.length && <p className="hint">種類別集計は先頭{MAX_LISTED}種類を表示しています（全 {formatNumber(result.kindCount)} 種類）。</p>}
        <DiagnosticOutput input={input} kind="invisibleKinds" label="不可視文字の種類別集計" />
      </>}
      {result.occurrenceCount > 0 && <>
        <h3>タブ・特殊な空白・制御文字などの出現位置</h3>
        <p className="hint">通常の半角・全角スペースとCRLF・LF・CRの改行は、この一覧には含めません。</p>
        <div className="table-scroll">
          <table className="line-table" aria-label="不可視文字の出現位置">
            <thead><tr><th>位置</th><th>種類</th><th>コードポイント</th><th>UTF-16位置（0始まり）</th></tr></thead>
            <tbody>{result.occurrences.map((item) => <tr key={item.offset}>
              <td>{item.line}行目 {item.column}文字目</td><td><code>[{item.marker}]</code> {item.name}</td>
              <td className="mono">{item.codePoint}</td><td className="mono">{formatNumber(item.offset)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="hint">検出位置は先頭 {formatNumber(result.occurrences.length)} 件を表示しています（全 {formatNumber(result.occurrenceCount)} 件）。</p>
        <DiagnosticOutput input={input} kind="invisibleOccurrences" label="不可視文字の出現位置" />
      </>}
    </section>
  );
}
