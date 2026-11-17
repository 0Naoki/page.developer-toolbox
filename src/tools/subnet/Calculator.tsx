import { useMemo } from 'react';
import { Badge } from '../../components/Badge';
import { Notice } from '../../components/Notice';
import { KvRow } from '../../components/KvRow';
import { useInput } from '../../hooks/useInput';
import { binaryOf, contains, formatIpv4, kindOf, parseIpv4, parseNetwork, subnetInfo, type ParsedNetwork } from './ipv4';
import { binaryOf6, contains6, expandIpv6, formatCount, formatIpv6, kindOf6, parseIpv6, parseNetwork6, subnetInfo6 } from './ipv6';
import { cidr } from './format';
import { formatNumber } from '../../lib/number';
import { useNetwork } from './useNetwork';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';

/** 入力の形式の表示名。IPv4・IPv6 のどちらの形式も、表に名前がある */
const NOTATION: Record<ParsedNetwork['notation'], string> = {
  cidr: 'CIDR',
  mask: 'サブネットマスク',
  wildcard: 'ワイルドカードマスク',
  host: 'アドレスだけ（/32 として計算）',
};

export function Calculator({ cloud }: { cloud: boolean }) {
  const [input, setInput] = useInput('subnet:input');
  const [check, setCheck] = useInput('subnet:check');
  const network = useNetwork(input, cloud);
  const { v6, result } = network;

  /** 判定の見出しに出すネットワークと、判定する関数。どちらも解析できたときだけ */
  const target = useMemo(() => {
    if (network.v6) {
      const r = network.result;
      return r?.ok ? { label: `${formatIpv6(r.info.network)}/${r.info.prefix}`, inside: (text: string) => contains6(r.info.network, r.info.prefix, parseIpv6(text)) } : null;
    }
    const r = network.result;
    return r?.ok ? { label: cidr(r.info.network, r.info.prefix), inside: (text: string) => contains(r.info.network, r.info.prefix, parseIpv4(text)) } : null;
  }, [network]);

  const checked = useMemo(() => {
    if (!check.trim() || !target) return null;
    return attempt(() => ({ inside: target.inside(check) }));
  }, [target, check]);

  return (
    <>
      <div className="input-row">
        <input
          aria-label="アドレスとプレフィックス長、またはマスク"
          className="input mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="192.168.10.0/24 / 10.0.0.5 255.255.255.0 / 2001:db8::/32"
        />
        {/** ネットワークと、含まれるかを判定するアドレスの両方を入れる（プライベートアドレスの架空の値） */}
        <button type="button" className="btn btn-ghost" onClick={() => {
          setInput('192.168.10.0/24');
          setCheck('192.168.10.200');
        }}>
          サンプル
        </button>
      </div>
      {result && !result.ok && <ErrorText message={result.error} />}
      {!network.v6 && network.result?.ok && <SubnetTable parsed={network.result.parsed} info={network.result.info} />}
      {network.v6 && network.result?.ok && <SubnetTable6 parsed={network.result.parsed} info={network.result.info} />}

      {result?.ok && (
        <>
          <h2 className="section-title">含まれるか判定</h2>
          <div className="input-row">
            <input
              aria-label="判定するアドレス"
              className="input mono"
              value={check}
              onChange={(e) => setCheck(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder={v6 ? '2001:db8::1' : '192.168.10.200'}
            />
          </div>
          {checked && !checked.ok && <ErrorText message={checked.error} />}
          {checked?.ok && (
            <div className="status-row">
              {checked.inside ? (
                <Badge tone="good">{target?.label} に含まれます</Badge>
              ) : (
                <Badge tone="bad">{target?.label} に含まれません</Badge>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function SubnetTable({ parsed, info }: { parsed: ReturnType<typeof parseNetwork>; info: ReturnType<typeof subnetInfo> }) {
  const kind = kindOf(info.network, info.broadcast);
  const isHost = parsed.ip !== info.network;
  const range = info.first === null || info.last === null ? 'なし' : `${formatIpv4(info.first)} 〜 ${formatIpv4(info.last)}`;
  const noBroadcast = info.prefix >= 31;

  return (
    <>
      {isHost && parsed.notation !== 'host' && (
        <Notice tone="warn">
          {formatIpv4(parsed.ip)} はこのサブネットのホストのアドレスです。ネットワークは {cidr(info.network, info.prefix)} です。
        </Notice>
      )}
      {info.notes.map((n) => (
        <Notice key={n} message={n} />
      ))}
      <table className="kv">
        <tbody>
          <KvRow label="CIDR" value={cidr(info.network, info.prefix)} />
          <KvRow label="入力の形式" value={NOTATION[parsed.notation]} copy={false} />
          <KvRow label="ネットワーク" value={formatIpv4(info.network)} />
          <KvRow label="ブロードキャスト" value={noBroadcast ? `なし（/${info.prefix}）` : formatIpv4(info.broadcast)} copy={!noBroadcast} />
          <KvRow label="利用できる範囲" value={range} copy={false} />
          <KvRow label="ホスト数" value={`${formatNumber(info.usable)}（全体 ${formatNumber(info.total)} アドレス）`} copy={false} />
          <KvRow label="サブネットマスク" value={formatIpv4(info.mask)} />
          <KvRow label="ワイルドカード" value={formatIpv4(info.wildcard)} />
          <KindRow kind={kind} />
        </tbody>
      </table>

      <h2 className="section-title">2進数（ネットワーク部とホスト部）</h2>
      <table className="kv">
        <tbody>
          <BinaryRow label="アドレス" value={parsed.ip} prefix={info.prefix} />
          <BinaryRow label="マスク" value={info.mask} prefix={info.prefix} />
          <BinaryRow label="ネットワーク" value={info.network} prefix={info.prefix} />
        </tbody>
      </table>
      <p className="hint">
        <span className="net-part">色付き</span>がネットワーク部（{info.prefix}ビット）、残りがホスト部（{32 - info.prefix}ビット）です。
      </p>
    </>
  );
}

function SubnetTable6({ parsed, info }: { parsed: ReturnType<typeof parseNetwork6>; info: ReturnType<typeof subnetInfo6> }) {
  const kind = kindOf6(info.network, info.last);
  const range = info.first === null || info.lastUsable === null ? 'なし' : `${formatIpv6(info.first)} 〜 ${formatIpv6(info.lastUsable)}`;
  const network = `${formatIpv6(info.network)}/${info.prefix}`;

  return (
    <>
      {parsed.ip !== info.network && parsed.notation !== 'host' && (
        <Notice tone="warn">
          {formatIpv6(parsed.ip)} はこのプレフィックスの中のアドレスです。プレフィックスは {network} です。
        </Notice>
      )}
      {info.notes.map((n) => (
        <Notice key={n} message={n} />
      ))}
      <table className="kv">
        <tbody>
          <KvRow label="プレフィックス" value={network} />
          <KvRow label="入力の形式" value={parsed.notation === 'host' ? 'アドレスだけ（/128 として計算）' : 'CIDR'} copy={false} />
          <KvRow label="先頭" value={formatIpv6(info.network)} />
          <KvRow label="末尾" value={formatIpv6(info.last)} />
          <KvRow label="利用できる範囲" value={range} copy={false} />
          <KvRow label="アドレス数" value={formatCount(info.usable)} copy={false} />
          {info.prefix <= 64 && <KvRow label="/64 の数" value={formatCount(1n << BigInt(64 - info.prefix))} copy={false} />}
          <KvRow label="省略しない表記" value={expandIpv6(parsed.ip)} />
          <KindRow kind={kind} />
        </tbody>
      </table>

      <h2 className="section-title">2進数（ネットワーク部とインターフェースID部）</h2>
      <table className="kv">
        <tbody>
          <tr>
            <th>アドレス</th>
            <td className="mono binary">
              <BinaryText bits={binaryOf6(parsed.ip)} prefix={info.prefix} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="hint">
        <span className="net-part">色付き</span>がネットワーク部（{info.prefix}ビット）、残りがインターフェースID部（{128 - info.prefix}ビット）です。
      </p>
    </>
  );
}

/** 区切り文字（. や :）を数えずに、先頭 prefix ビットを色付きにする */
function BinaryText({ bits, prefix }: { bits: string; prefix: number }) {
  let cut = 0;
  for (let n = 0; n < prefix; cut++) if (bits[cut] === '0' || bits[cut] === '1') n++;
  return (
    <>
      <span className="net-part">{bits.slice(0, cut)}</span>
      {bits.slice(cut)}
    </>
  );
}

function BinaryRow({ label, value, prefix }: { label: string; value: number; prefix: number }) {
  return (
    <tr>
      <th>{label}</th>
      <td className="mono binary">
        <BinaryText bits={binaryOf(value)} prefix={prefix} />
      </td>
    </tr>
  );
}

/** アドレスの種別の行（IPv4・IPv6 で共通）。範囲の一部だけが重なる種別は、その旨を先に書く */
function KindRow({ kind }: { kind: { kinds: { label: string; rfc?: string; cidr?: string }[]; partial: boolean } }) {
  return (
    <tr>
      <th>種別</th>
      <td>
        {kind.partial && <span className="muted">一部が次の範囲に重なります：</span>}
        {kind.kinds.map((k) => (
          <span key={k.label + (k.cidr ?? '')} className="kind-item">
            {k.label}
            {k.rfc && <span className="muted">（{k.cidr}、{k.rfc}）</span>}
          </span>
        ))}
      </td>
      <td />
    </tr>
  );
}
