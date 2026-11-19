import { useMemo } from 'react';
import { Notice } from '../../components/Notice';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { CalculationStatus } from '../../components/CalculationStatus';
import { LargeTextInput } from '../../components/LargeTextInput';
import { useInput } from '../../hooks/useInput';
import { useCalculation } from '../../hooks/useCalculation';
import { MAX_OVERLAPS } from './ranges';
import { MAX_MESSAGES } from './listCalculation';
import { Errors } from './Errors';
import { previewList } from '../../lib/listPreview';
import { formatNumber } from '../../lib/number';

export function OverlapCheck() {
  const [text, setText] = useInput('subnet:list');
  const request = useMemo(() => ({ tool: 'subnetOverlap' as const, input: text }), [text]);
  const calculation = useCalculation(request);
  const result = text ? calculation.result : null;
  const warnings = result ? previewList(result.warnings.items, MAX_MESSAGES, result.warnings.total) : null;
  const name = (b: { text: string; label: string; line: number }) => `${b.text}${b.label ? `（${b.label}）` : ''}［${b.line}行目］`;

  return (
    <>
      {/** 数万行の一覧を普通の textarea で描画すると画面が止まるため、表示を先頭までにする */}
      <LargeTextInput limit={MAX_CALCULATION_INPUT}
        label="CIDR の一覧（1行に1つ。後ろに名前を書けます）"
        className="code code-mid"
        value={text}
        onChange={setText}
        placeholder={'10.0.0.0/16 本番VPC\n10.1.0.0/16 検証VPC\n10.0.128.0/20 拠点A  # 行の # 以降はコメント\n2001:db8::/56 本番VPC（IPv6）'}
      />
      {text && <CalculationStatus {...calculation} />}
      {result && <Errors errors={result.errors.items} total={result.errors.total} />}
      {/** 数万行の一覧でも画面が重くならないよう、エラーと同じく先頭20件だけ表示する */}
      {warnings?.shown.map((w) => (
        <Notice key={`${w.line}:${w.message}`} tone="warn" message={`${w.line}行目：${w.message}`} />
      ))}
      {warnings && warnings.rest > 0 && (
        <Notice tone="warn">ほか {formatNumber(warnings.rest)} 行も、ネットワークアドレスに直して扱いました</Notice>
      )}
      {result && result.count > 0 &&
        (result.overlaps.length === 0 ? (
          <Notice tone="good">{result.count} 件の範囲に、重なりはありません。</Notice>
        ) : (
          <>
            <Notice tone="bad">
              {result.overlaps.length}
              {result.truncated && '件以上（先頭 ' + MAX_OVERLAPS + ' 件を表示）'}
              {!result.truncated && '件'}の重なりがあります。
            </Notice>
            <ul className="overlap-list">
              {result.overlaps.map((o) => (
                <li key={`${o.a.line}-${o.b.line}`} className="mono">
                  {o.kind === 'same' ? `${name(o.a)} と ${name(o.b)} は同じ範囲です` : `${name(o.a)} は ${name(o.b)} を含みます`}
                </li>
              ))}
            </ul>
          </>
        ))}
      <p className="hint">CIDR の範囲は、一方がもう一方を含むか、まったく重ならないかのどちらかです（一部だけ重なることはありません）。</p>
    </>
  );
}
