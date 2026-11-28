/**
 * cron式の解説のファイルの分担。
 * - `parse.ts`：構文解析
 * - `nextRuns.ts`：次回の実行日時の探索
 * - `describe.ts`：説明文の生成
 * - `build.ts`・`Builder.tsx`：頻度と時刻から式を組み立てる
 */
import { useMemo } from 'react';
import { Notice } from '../../components/Notice';
import { CopyButton } from '../../components/CopyButton';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { useInput } from '../../hooks/useInput';
import { useNow } from '../../hooks/useNow';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { availableZones, isStoredZone, JST_ZONE as JST, type Zone } from '../../lib/time/timezone';
import { parseDateTime } from '../../lib/time/dateTimeInput';
import { relativeFrom } from '../../lib/time/dateTimeFormat';
import { cronWarnings, describeCron, fieldRows } from './describe';
import { SEARCH_YEARS, formatRun, nextRuns } from './nextRuns';
import { parseCron, type Dialect } from './parse';
import { ErrorBox } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';
import { Builder } from './Builder';

const RUN_COUNT = 10;
const REFRESH_MS = 30_000;

const FORMATS: Record<Dialect, { placeholder: string; hint: string }> = {
  unix: { placeholder: '分 時 日 月 曜日', hint: '曜日は 0・7 が日曜です。GitHub Actions は UTC で読むため、「式を読むタイムゾーン」を UTC にしてください。' },
  kubernetes: { placeholder: '分 時 日 月 曜日', hint: '曜日は 0〜6（日〜土）です。5/15 は5分から15分間隔、? は * と同じです。CronJob の .spec.timeZone に合わせてタイムゾーンを選んでください（省略時はコントローラのタイムゾーン）。' },
  quartz: { placeholder: '秒 分 時 日 月 曜日 [年]', hint: '曜日は 1 が日曜です。日と曜日のどちらか一方を ? にします。L（月末）、W（最も近い平日）、#（第n曜日）が使えます。' },
  aws: { placeholder: '分 時 日 月 曜日 年', hint: '曜日は 1 が日曜です。日と曜日のどちらか一方を ? にします。EventBridge のルールは UTC で読むため、「式を読むタイムゾーン」を UTC にしてください（EventBridge Scheduler はタイムゾーンを指定できます）。' },
};

const PRESETS: { label: string; values: Record<Exclude<Dialect, 'kubernetes'>, string> }[] = [
  { label: '5分ごと', values: { unix: '*/5 * * * *', quartz: '0 */5 * * * ?', aws: '*/5 * * * ? *' } },
  { label: '毎時0分', values: { unix: '0 * * * *', quartz: '0 0 * * * ?', aws: '0 * * * ? *' } },
  { label: '毎日9時', values: { unix: '0 9 * * *', quartz: '0 0 9 * * ?', aws: '0 9 * * ? *' } },
  { label: '平日9時', values: { unix: '0 9 * * 1-5', quartz: '0 0 9 ? * MON-FRI', aws: '0 9 ? * MON-FRI *' } },
  { label: '毎月1日', values: { unix: '0 0 1 * *', quartz: '0 0 0 1 * ?', aws: '0 0 1 * ? *' } },
];

export default function CronTool() {
  const [input, setInput] = useInput('cron');
  const [base, setBase] = useInput('cron:base');
  const [dialect, setDialect] = usePreference<Dialect>('cron:dialect', 'unix', oneOf('unix', 'kubernetes', 'quartz', 'aws'));
  const [zone, setZone] = usePreference<Zone>('cron:zone', JST, isStoredZone);
  /**
   * 基準日時が空欄のときは、開いたままでも次回の実行日時を更新する。基準日時を入れている間は止める
   * （基準日時を消したときは、useNow がすぐに現在時刻にする）
   */
  const now = useNow(REFRESH_MS, !base.trim());
  const zones = useMemo(() => [JST, 'UTC', ...availableZones().filter((z) => z !== JST && z !== 'UTC')], []);

  const result = useMemo(() => {
    if (!input.trim()) return null;
    return attempt(() => {
      const cron = parseCron(input, dialect);
      const from = base.trim() ? parseDateTime(base, JST).getTime() : now;
      return {
        from,
        expanded: cron.expanded,
        description: describeCron(cron),
        rows: fieldRows(cron),
        warnings: cronWarnings(cron),
        runs: nextRuns(cron, zone, from, RUN_COUNT),
      };
    });
  }, [input, base, dialect, zone, now]);

  const format = FORMATS[dialect];
  const showZone = zone !== JST;

  return (
    <ToolShell description="cron式の意味を日本語で説明し、次回の実行日時を日本時間で表示します。入力は外部に送信しません。">
      <div className="toolbar">
        <Segmented<Dialect>
          label="形式"
          value={dialect}
          onChange={setDialect}
          options={[
            { value: 'unix', label: '標準（5項目）' },
            { value: 'kubernetes', label: 'Kubernetes' },
            { value: 'quartz', label: 'Quartz' },
            { value: 'aws', label: 'EventBridge' },
          ]}
        />
        <label>
          式を読むタイムゾーン
          <select aria-label="式を読むタイムゾーン" value={zone} onChange={(e) => setZone(e.target.value)}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field-label">cron式</span>
        <input className="input mono" aria-label="cron式" spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} placeholder={format.placeholder} />
      </label>
      <div className="toolbar">
        {PRESETS.map((preset) => (
          <button key={preset.label} type="button" className="btn btn-ghost" onClick={() => setInput(preset.values[dialect === 'kubernetes' ? 'unix' : dialect])}>
            {preset.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => setInput('')}>クリア</button>
      </div>
      <p className="hint">{format.hint}</p>
      <Builder dialect={dialect} onUse={setInput} />

      {result && !result.ok && <ErrorBox alert message={result.error} />}
      {result?.ok && (
        <>
          <section className="panel">
            <h2 className="panel-title">意味</h2>
            <p>{result.description}</p>
            {result.expanded && <p className="hint">{result.expanded} と同じです</p>}
            {result.warnings.map((warning) => <Notice key={warning} tone="warn" message={warning} />)}
            <table className="kv" aria-label="項目ごとの内訳">
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    <td className="mono">{row.source}</td>
                    <td>{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2 className="panel-title">
              次回の実行日時
              <CopyButton text={result.runs.map((run) => `${formatRun(run, JST)} JST`).join('\n')} />
            </h2>
            {result.runs.length === 0 ? (
              <Notice tone="warn">{SEARCH_YEARS}年先まで探しましたが、この式では実行されません</Notice>
            ) : (
              <table className="data-table" aria-label="次回の実行日時">
                <thead>
                  <tr>
                    <th>日本時間（JST）</th>
                    {showZone && <th>{zone}</th>}
                    <th>基準から</th>
                  </tr>
                </thead>
                <tbody>
                  {result.runs.map((run) => (
                    <tr key={run}>
                      <td className="mono">{formatRun(run, JST)}</td>
                      {/** 基準日時（日本時間）に貼り戻しても同じ時刻になるよう、UTC からのずれを付ける */}
                      {showZone && <td className="mono">{formatRun(run, zone, true)}</td>}
                      <td>{relativeFrom(new Date(run), result.from)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <label className="field">
        <span className="field-label">基準日時（JST。空欄なら現在。次回の実行日時を貼り付けてもよい）</span>
        <input className="input mono" aria-label="基準日時" spellCheck={false} value={base} onChange={(e) => setBase(e.target.value)} placeholder="2026-10-02 09:00:00" />
      </label>
    </ToolShell>
  );
}
