import { useMemo } from 'react';
import { Badge } from '../../components/Badge';
import { CalculationStatus } from '../../components/CalculationStatus';
import { CopyButton } from '../../components/CopyButton';
import { LargeTextInput } from '../../components/LargeTextInput';
import { useInput } from '../../hooks/useInput';
import { useCalculation } from '../../hooks/useCalculation';
import { formatCount } from './ipv6';
import { formatNumber } from '../../lib/number';
import { Errors } from './Errors';
import { TextOutputPreview } from '../../components/FormattedOutput';

export function Aggregator() {
  const [text, setText] = useInput('subnet:aggregate');
  const request = useMemo(() => ({ tool: 'subnetAggregate' as const, input: text }), [text]);
  const calculation = useCalculation(request);
  const result = text ? calculation.result : null;

  return (
    <>
      {/** 数万行の一覧を普通の textarea で描画すると画面が止まるため、表示を先頭までにする */}
      <LargeTextInput
        label="CIDR・アドレスの範囲・アドレスの一覧（1行に1つ）"
        className="code code-mid"
        value={text}
        onChange={setText}
        placeholder={'10.0.0.0/24\n10.0.1.0/24\n192.168.0.10 - 192.168.0.40\n172.16.5.1\n2001:db8::/33\n2001:db8:8000::/33'}
      />
      {text && <CalculationStatus {...calculation} />}
      {result && <Errors errors={result.errors.items} total={result.errors.total} />}
      {result && result.count > 0 && (
        <>
          <div className="status-row">
            <Badge>{formatNumber(result.count)} 個の CIDR</Badge>
            <Badge>{result.addresses6 === null ? formatNumber(result.addresses4) : `IPv4 ${formatNumber(result.addresses4)}・IPv6 ${formatCount(result.addresses6)}`} アドレス</Badge>
            <CopyButton text={result.output} label="一覧をコピー" />
          </div>
          <TextOutputPreview label="集約結果" text={result.output} as="pre" />
        </>
      )}
      <p className="hint">
        重なる範囲や隣り合う範囲をまとめ、それをちょうど覆う最小個数の CIDR にします。「開始 - 終了」の範囲は、CIDR の一覧に変換します。
      </p>
    </>
  );
}
