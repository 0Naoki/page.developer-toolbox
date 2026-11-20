import { useMemo } from 'react';
import { Badge } from '../../components/Badge';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { Notice } from '../../components/Notice';
import { CalculationStatus } from '../../components/CalculationStatus';
import { CopyButton } from '../../components/CopyButton';
import { LargeTextInput } from '../../components/LargeTextInput';
import { Segmented } from '../../components/Segmented';
import { useInput } from '../../hooks/useInput';
import { useCalculation } from '../../hooks/useCalculation';
import { usePreference } from '../../hooks/usePreference';
import { integerBetween, oneOf } from '../../lib/settings';
import { formatIpv4, splitNetwork, subnetInfo } from './ipv4';
import { MAX_ROWS } from './ranges';
import { formatCount, formatIpv6, splitNetwork6, subnetInfo6 } from './ipv6';
import { cidr } from './format';
import { formatNumber } from '../../lib/number';
import { downloadText } from '../../lib/file';
import { useNetwork } from './useNetwork';
import { Errors } from './Errors';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';

/** 既存の保存形式（選択肢と同じ10進文字列）のプレフィックスだけを受け付ける。 */
function prefixSetting(max: number) {
  const valid = integerBetween(0, max);
  return (value: unknown): value is string =>
    typeof value === 'string' && valid(Number(value)) && value === String(Number(value));
}

const isPrefix4 = prefixSetting(32);
const isPrefix6 = prefixSetting(128);

export function Splitter({ cloud }: { cloud: boolean }) {
  const [input, setInput] = useInput('subnet:split', '10.0.0.0/16');
  const [mode, setMode] = usePreference<'equal' | 'vlsm'>('subnet:splitMode', 'equal', oneOf('equal', 'vlsm'));
  const [newPrefixText, setNewPrefix] = usePreference('subnet:newPrefix', '24', isPrefix4);
  const [requestsText, setRequests] = useInput('subnet:requests');
  const [newPrefix6Text, setNewPrefix6] = usePreference('subnet:newPrefix6', '64', isPrefix6);
  const network = useNetwork(input, false);
  const { v6 } = network;
  /** 種類ごとの解析結果。もう片方は null（入力が空のときも null） */
  const base = network.v6 ? null : network.result;
  const base6 = network.v6 ? network.result : null;
  const newPrefix = Math.max(base?.ok ? base.info.prefix : 0, Number(newPrefixText));
  const newPrefix6 = Math.max(base6?.ok ? base6.info.prefix : 0, Number(newPrefix6Text));

  return (
    <>
      <div className="toolbar">
        <input
          aria-label="分割するネットワーク"
          className="input mono input-num-wide"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="10.0.0.0/16 / 2001:db8::/48"
        />
        {!v6 && (
          <Segmented
            label="分け方"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'equal', label: '同じ大きさに分ける' },
              { value: 'vlsm', label: '必要なホスト数で割り当て（VLSM）' },
            ]}
          />
        )}
        {v6 && base6?.ok && (
          <label>
            分割後
            <select value={String(newPrefix6)} onChange={(e) => setNewPrefix6(e.target.value)}>
              {Array.from({ length: 129 - base6.info.prefix }, (_, i) => base6.info.prefix + i).map((p) => (
                <option key={p} value={String(p)}>
                  /{p}（{formatCount(1n << BigInt(p - base6.info.prefix))} 個）
                </option>
              ))}
            </select>
          </label>
        )}
        {!v6 && mode === 'equal' && base?.ok && (
          <label>
            分割後
            <select value={String(newPrefix)} onChange={(e) => setNewPrefix(e.target.value)}>
              {Array.from({ length: 33 - base.info.prefix }, (_, i) => base.info.prefix + i).map((p) => (
                <option key={p} value={String(p)}>
                  /{p}（{formatNumber(2 ** (p - base.info.prefix))} 個）
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {base && !base.ok && <ErrorText message={base.error} />}
      {base?.ok && base.parsed.ip !== base.info.network && (
        <Notice tone="warn">ネットワーク {cidr(base.info.network, base.info.prefix)} として分割します。</Notice>
      )}
      {base?.ok && mode === 'equal' && <EqualSplit network={base.info.network} prefix={base.info.prefix} newPrefix={newPrefix} cloud={cloud} />}
      {v6 && base6 && !base6.ok && <ErrorText message={base6.error} />}
      {v6 && base6?.ok && (
        <EqualSplit6 network={base6.info.network} prefix={base6.info.prefix} newPrefix={newPrefix6} cloud={cloud} />
      )}
      {v6 && <p className="hint">IPv6 のサブネットは /64 で割り当てるのが一般的なため、必要なホスト数での割り当て（VLSM）は IPv4 だけに対応しています。</p>}
      {base?.ok && mode === 'vlsm' && (
        <>
          {/** 数万行の一覧を普通の textarea で描画すると画面が止まるため、表示を先頭までにする */}
          <LargeTextInput limit={MAX_CALCULATION_INPUT}
            label="サブネットの名前と必要なホスト数（1行に1つ）"
            className="code code-short"
            value={requestsText}
            onChange={setRequests}
            placeholder={'営業部 120\n開発部 60\nサーバー 20'}
          />
          <Vlsm network={base.info.network} prefix={base.info.prefix} text={requestsText} cloud={cloud} />
        </>
      )}
    </>
  );
}

function EqualSplit6({ network, prefix, newPrefix, cloud }: { network: bigint; prefix: number; newPrefix: number; cloud: boolean }) {
  const p = newPrefix;
  const result = useMemo(() => {
    return attempt(() => splitNetwork6(network, prefix, p));
  }, [network, prefix, p]);
  if (!result.ok) return <ErrorText message={result.error} />;
  const rows = result.subnets.map((n) => ({ n }));
  /** 大きさはどのサブネットも同じなので、先頭の1件だけで求める */
  const first = result.subnets[0];
  const usable = first === undefined ? 0n : subnetInfo6(first, p, cloud).usable;
  return (
    <>
      <div className="status-row">
        <Badge>{formatCount(result.count)} 個のサブネット</Badge>
        <Badge>1つあたり {formatCount(usable)} アドレス</Badge>
        <CopyButton text={rows.map((r) => `${formatIpv6(r.n)}/${p}`).join('\n')} label={result.count > BigInt(MAX_ROWS) ? `先頭${formatNumber(MAX_ROWS)}件をコピー` : '一覧をコピー'} />
      </div>
      {result.count > BigInt(MAX_ROWS) && <SplitOutput input={`${formatIpv6(network)}/${prefix}`} newPrefix={p} />}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>プレフィックス</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="mono">
                  {formatIpv6(r.n)}/{p}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.count > BigInt(MAX_ROWS) && (
        <p className="hint">
          先頭 {formatNumber(MAX_ROWS)} 個を表示しています（全 {formatCount(result.count)} 個）。
        </p>
      )}
    </>
  );
}

function EqualSplit({ network, prefix, newPrefix, cloud }: { network: number; prefix: number; newPrefix: number; cloud: boolean }) {
  const result = useMemo(() => {
    return attempt(() => splitNetwork(network, prefix, newPrefix));
  }, [network, prefix, newPrefix]);
  if (!result.ok) return <ErrorText message={result.error} />;
  const p = newPrefix;
  const rows = result.subnets.map((n) => ({ n, info: subnetInfo(n, p, cloud) }));

  return (
    <>
      <div className="status-row">
        <Badge>{formatNumber(result.count)} 個のサブネット</Badge>
        <Badge>1つあたり {formatNumber(rows[0]?.info.usable ?? 0)} ホスト</Badge>
        <CopyButton text={rows.map((r) => cidr(r.n, p)).join('\n')} label={result.count > MAX_ROWS ? `先頭${formatNumber(MAX_ROWS)}件をコピー` : '一覧をコピー'} />
      </div>
      {result.count > MAX_ROWS && <SplitOutput input={cidr(network, prefix)} newPrefix={p} />}
      <SubnetRows rows={rows.map((r, i) => ({ key: String(i), name: String(i + 1), network: r.n, prefix: p, info: r.info }))} />
      {result.count > MAX_ROWS && (
        <p className="hint">
          先頭 {formatNumber(MAX_ROWS)} 個を表示しています（全 {formatNumber(result.count)} 個）。
        </p>
      )}
    </>
  );
}

/** 均等分割の全件出力。要求が変わった描画から古い出力をコピー・保存へ渡さない。 */
function SplitOutput({ input, newPrefix }: { input: string; newPrefix: number }) {
  const calculation = useCalculation({ tool: 'subnetSplit', input, newPrefix });
  const output = calculation.result?.output ?? '';
  return (
    <div className="stack">
      <CalculationStatus {...calculation} />
      <div className="toolbar">
        <CopyButton text={output} label="全件をコピー" />
        <button type="button" className="btn btn-ghost" disabled={!output} onClick={() => downloadText('subnets.txt', output, 'text/plain')}>全件を保存</button>
      </div>
    </div>
  );
}

function Vlsm({ network, prefix, text, cloud }: { network: number; prefix: number; text: string; cloud: boolean }) {
  const request = useMemo(() => ({ tool: 'subnetVlsm' as const, input: text, network, prefix, cloud }), [network, prefix, text, cloud]);
  const calculation = useCalculation(request);
  const result = calculation.result;

  return (
    <>
      {text && <CalculationStatus {...calculation} />}
      {result && <Errors errors={result.errors.items} total={result.errors.total} />}
      {result?.error && <ErrorText message={result.error} />}
      {result && result.count > 0 && (
        <>
          <div className="status-row">
            <CopyButton text={result.output} label="一覧をコピー" />
          </div>
          <SubnetRows
            rows={result.rows.map((a) => ({
              key: String(a.line),
              name: `${a.name}（${formatNumber(a.hosts)}）`,
              network: a.network,
              prefix: a.prefix,
              info: subnetInfo(a.network, a.prefix, cloud),
            }))}
          />
          {result.count > MAX_ROWS && (
            <p className="hint">
              先頭 {formatNumber(MAX_ROWS)} 個を表示しています（全 {formatNumber(result.count)} 個）。
            </p>
          )}
          <p className="hint">大きいサブネットから順に、先頭から割り当てています。かっこ内は必要なホスト数です。</p>
        </>
      )}
    </>
  );
}

function SubnetRows({ rows }: { rows: { key: string; name: string; network: number; prefix: number; info: ReturnType<typeof subnetInfo> }[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>CIDR</th>
            <th>利用できる範囲</th>
            <th className="right">ホスト数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td className="mono">{cidr(r.network, r.prefix)}</td>
              <td className="mono">
                {r.info.first === null || r.info.last === null ? 'なし' : `${formatIpv4(r.info.first)} 〜 ${formatIpv4(r.info.last)}`}
              </td>
              <td className="right">{formatNumber(r.info.usable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
