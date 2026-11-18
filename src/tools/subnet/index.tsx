/**
 * IPアドレス・サブネット計算のファイルの分担。この画面はタブと、タブ間で共有する設定（クラウドの予約）を担当する。
 * - `ipv4.ts`：IPv4 の解析・表示・サブネットの情報・種別と、一覧（読み取り・分割・集約）の IPv4 での呼び出し
 * - `ipv6.ts`：IPv6 の解析・表示・集約（`ipv4.ts` と対になる）
 * - `addressRange.ts`：単独アドレスと範囲の字句の区別（ゾーンID内の記号を保つ）
 * - `ranges.ts`：IPv4 と IPv6 で共通の範囲と CIDR の計算（集約・一覧の読み取り・分割・重なりの検出）。種類ごとの違いは ipv4.ts・ipv6.ts の Family
 * - `vlsm.ts`：必要なホスト数に合わせた割り当て（VLSM。IPv4 だけ）
 * - `listCalculation.ts`：Worker から呼ぶ一覧の計算と、出力の上限
 * - `cloudPolicy.ts`：クラウドの予約アドレス数と、作成できるサブネットサイズの案内
 * - `format.ts`：数値・CIDR の表示
 * - `useNetwork.ts`：入力欄のネットワークを IPv4・IPv6 のどちらかとして解析するフック（判定は一覧のタブと同じ `isIpv6Text`）
 * - `Calculator.tsx`・`OverlapCheck.tsx`・`Splitter.tsx`・`Aggregator.tsx`：各タブの画面（`Errors.tsx` は一覧のエラー表示）
 */
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { usePreference } from '../../hooks/usePreference';
import { isBoolean, oneOf } from '../../lib/settings';
import { Calculator } from './Calculator';
import { OverlapCheck } from './OverlapCheck';
import { Splitter } from './Splitter';
import { Aggregator } from './Aggregator';
import { Check } from '../../components/Check';

type Tab = 'calc' | 'overlap' | 'split' | 'aggregate';

export default function SubnetTool() {
  const [tab, setTab] = usePreference<Tab>('subnet:tab', 'calc', oneOf('calc', 'overlap', 'split', 'aggregate'));
  const [cloud, setCloud] = usePreference('subnet:cloud', false, isBoolean);

  return (
    <ToolShell
      description="IPv4・IPv6 のサブネットの計算、範囲の重複チェック、分割（VLSM）、集約。IPv4 は 192.168.10.0/24・サブネットマスク・ワイルドカードマスクのどれでも、IPv6 は 2001:db8::/32 の形で入力できます。"
    >
      <div className="toolbar">
        <Segmented<Tab>
          label="機能"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'calc', label: '計算' },
            { value: 'overlap', label: '重複チェック' },
            { value: 'split', label: '分割' },
            { value: 'aggregate', label: '集約・範囲変換' },
          ]}
        />
        {(tab === 'calc' || tab === 'split') && (
          <Check label="AWS・Azure の予約（5アドレス）を除く" checked={cloud} onChange={setCloud} />
        )}
      </div>
      {tab === 'calc' && <Calculator cloud={cloud} />}
      {tab === 'overlap' && <OverlapCheck />}
      {tab === 'split' && <Splitter cloud={cloud} />}
      {tab === 'aggregate' && <Aggregator />}
    </ToolShell>
  );
}
