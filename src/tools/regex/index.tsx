/**
 * 正規表現テスターのファイルの分担。
 * - `logic.ts`：マッチ・キャプチャ・置換の計算と上限
 * - `worker.ts`：正規表現の Worker の入口（打ち切れるよう、画面とは別の Worker で実行する）
 * - `createWorker.ts`：その Worker の起動（createTrustedWorker）
 */
import { Fragment, useMemo, useState } from 'react';
import { Pane } from '../../components/Pane';
import { CopyButton } from '../../components/CopyButton';
import { LargeTextInput } from '../../components/LargeTextInput';
import { ToolShell } from '../../components/ToolShell';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { useWorkerJob, type WorkerJobOptions } from '../../hooks/useWorkerJob';
import { TEXT_PREVIEW_LIMIT } from '../../lib/text/textPreview';
import { createRegexWorker } from './createWorker';
import { MAX_MATCHES, MAX_TEXT, isStoredFlags, validateRegexInputSize, type Match, type RegexInput, type RegexResult } from './logic';
import { ErrorBox, ErrorText } from '../../components/ErrorMessage';
import { TextOutputPreview } from '../../components/FormattedOutput';
import { ClippedText } from '../../components/ClippedText';
import { formatNumber } from '../../lib/number';
import { Check } from '../../components/Check';

const FLAGS = [
  ['g', 'すべて検索'], ['i', '大文字小文字を無視'], ['m', '複数行の ^ / $'],
  ['s', '. が改行に一致'], ['u', 'Unicode'], ['y', '先頭から連続一致'],
] as const;
const TIMEOUT_MS = 2000;
const WORKER_OPTIONS: WorkerJobOptions<RegexInput> = {
  create: createRegexWorker,
  timeout: TIMEOUT_MS,
  timeoutAdvice: '正規表現やテスト文字列を短くしてください。',
  beforeStart: validateRegexInputSize,
};

export default function RegexTool() {
  const [pattern, setPattern] = useInput('regex:pattern');
  const [text, setText] = useInput('regex:text');
  const [replacement, setReplacement] = useInput('regex:replacement');
  const [storedFlags, setFlags] = usePreference('regex:flags', 'g', isStoredFlags);
  const flags = FLAGS.filter(([flag]) => storedFlags.includes(flag)).map(([flag]) => flag).join('');
  const [hasEdited, setHasEdited] = useState(false);
  /** 未操作の初期画面だけ案内を出す。操作後の空の式・空文字列も有効な検索として評価する。 */
  const idle = !hasEdited && pattern === '' && text === '' && replacement === '';
  const request = useMemo(() => (idle ? null : { pattern, text, flags, replacement }), [idle, pattern, text, flags, replacement]);
  const job = useWorkerJob<RegexInput, RegexResult>(request, WORKER_OPTIONS);
  const result: RegexResult | null = job.state === 'done' ? job.response : job.state === 'failed' ? { ok: false, error: job.error } : null;
  const output = result?.ok ? result.output ?? '' : '';

  return (
    <ToolShell description="JavaScript の正規表現でリアルタイムに検索し、キャプチャと置換結果を確認します。入力は外部に送信しません。">
      <label className="field">
        <span className="field-label">正規表現（前後の / は不要）</span>
        <input className="input mono" aria-label="正規表現" spellCheck={false} value={pattern} onChange={(e) => { setHasEdited(true); setPattern(e.target.value); }} placeholder={'(?<name>\\w+)=(\\d+)'} />
      </label>
      <div className="toolbar">
        {FLAGS.map(([flag, label]) => (
          <Check key={flag} label={<><code>{flag}</code> {label}</>} checked={flags.includes(flag)} onChange={(v) => { setHasEdited(true); setFlags(v ? flags + flag : flags.replace(flag, '')); }} />
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => {
          setHasEdited(true);
          setPattern('(?<name>\\w+)=(\\d+)'); setText('apple=12\nbanana=34'); setReplacement('$<name>: $2'); setFlags('g');
        }}>サンプル</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setHasEdited(false); setPattern(''); setText(''); setReplacement(''); }}>クリア</button>
      </div>
      <p className="hint">空の正規表現は文字の間に一致します。位置は0から数えるUTF-16単位で、終了位置は含みません。計算は{TIMEOUT_MS / 1000}秒で打ち切り、マッチは先頭{MAX_MATCHES}件まで表示します。置換はすべてのマッチに適用します。</p>
      <div className="split">
        {/** 入力欄の上に「元に戻す」などのボタンが並ぶため、label ではなく div で囲む（label の中のボタンが、見出しのクリックで押されないように） */}
        <Pane title="テスト文字列">
          {/** 長いテキストを普通の textarea で描画すると画面が止まるため、表示を先頭までにする。位置は改行の違いで変わるため、元の改行を保つ */}
          <LargeTextInput limit={MAX_TEXT} label="テスト文字列" className="code code-mid" value={text} onChange={(value) => { setHasEdited(true); setText(value); }} preserveLineEndings />
        </Pane>
        <Pane title="マッチの強調表示">
          <pre className="code code-pre regex-preview" aria-label="マッチの強調表示" role="region" tabIndex={0}>
            {/** 上限を超えた入力などで結果がないときは、全文を描画すると画面が止まるため、先頭だけを表示する（結果があるときの入力は上限以内） */}
            {result?.ok ? <Highlighted text={text} matches={result.matches} /> : <ClippedText text={text} limit={TEXT_PREVIEW_LIMIT} copy={false} />}
          </pre>
        </Pane>
      </div>
      <p role="status" aria-live="polite">
        {idle ? '正規表現とテスト文字列を入力してください' : !result ? '計算中…' : !result.ok ? '計算できません' : result.total === null ? `${result.matches.length}件以上のマッチ（先頭${MAX_MATCHES}件を表示）` : `${formatNumber(result.total)}件のマッチ${result.truncated ? `（先頭${MAX_MATCHES}件を表示）` : ''}`}
      </p>
      {result && !result.ok && <ErrorBox alert message={result.error} />}
      {result?.ok && result.matches.length > 0 && (
        <div className="regex-matches">
          {result.matches.map((match, i) => <MatchCard key={`${i}:${match.start}`} match={match} index={i} />)}
        </div>
      )}
      <div className="split">
        <Pane title="置換文字列">
          <LargeTextInput limit={MAX_TEXT} className="code code-short" label="置換文字列" value={replacement} onChange={(value) => { setHasEdited(true); setReplacement(value); }} />
          <span className="hint">{'$&：マッチ全体、$1〜$99：キャプチャ、$<名前>：名前付きキャプチャ、$$：$、$`：前の文字列、$\'：後ろの文字列'}</span>
        </Pane>
        <Pane title="置換結果" actions={<CopyButton text={output} />}>
          <TextOutputPreview label="置換結果" text={output} className="code code-short" />
          {result?.ok && result.replacementError && <ErrorText message={result.replacementError} />}
        </Pane>
      </div>
    </ToolShell>
  );
}

function MatchCard({ match, index }: { match: Match; index: number }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <details className="panel regex-match" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>マッチ {index + 1}：{match.start}〜{match.end}（{match.end - match.start} UTF-16単位）</summary>
      {/** 大量のキャプチャを一度に描画しないよう、開いた項目だけ中身を作る。 */}
      {open && <div className="stack">
        {/** マッチとキャプチャは1つで10万単位になり得るため、ClippedText で上限までにし、全文はコピーで取り出す */}
        <pre className="code code-pre">{match.value === '' ? '（空文字）' : <ClippedText text={match.value} />}</pre>
        {match.captures.length > 0 ? (
          <div className="regex-capture-wrap">
            <table className="kv" aria-label={`マッチ ${index + 1} のキャプチャ`}>
              <thead><tr><th>キャプチャ</th><th>値</th><th>位置</th></tr></thead>
              <tbody>{match.captures.map((capture) => (
                <tr key={capture.label}>
                  <th className="mono">{capture.label}</th>
                  <td className="mono regex-value">{capture.value === null ? '（未参加）' : capture.value === '' ? '（空文字）' : <ClippedText text={capture.value} />}</td>
                  <td className="mono">{capture.start === null ? '—' : `${capture.start}〜${capture.end}`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="hint">キャプチャグループはありません</p>}
      </div>}
    </details>
  );
}

function Highlighted({ text, matches }: { text: string; matches: Match[] }) {
  let from = 0;
  const parts = matches.map((match, i) => {
    const before = text.slice(from, match.start);
    from = match.end;
    return (
      <Fragment key={i}>
        {before}
        {match.start === match.end
          ? <span className="regex-empty" title={`空のマッチ：位置 ${match.start}`} aria-label={`空のマッチ：位置 ${match.start}`}>│</span>
          : <mark className="regex-hit" title={`マッチ ${i + 1}：${match.start}〜${match.end}`}>{match.value}</mark>}
      </Fragment>
    );
  });
  return <>{parts}{text.slice(from)}</>;
}
