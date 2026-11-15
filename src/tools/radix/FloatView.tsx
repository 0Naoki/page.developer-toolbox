import { useMemo } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Segmented } from '../../components/Segmented';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';
import {
  evaluateFloat,
  floatParts,
  type Precision,
} from './float';

/** float・double の内部表現 */

export function FloatView() {
  const [input, setInput] = useInput('radix:float');
  const [precision, setPrecision] = usePreference<Precision>('radix:precision', 64, oneOf(32, 64));

  const result = useMemo(() => {
    if (!input.trim()) return null;
    return attempt(() => ({ parts: floatParts(evaluateFloat(input, precision), precision) }));
  }, [input, precision]);

  return (
    <div className="panel">
      <div className="toolbar">
        <Segmented<Precision>
          label="精度"
          value={precision}
          onChange={setPrecision}
          options={[
            { value: 32, label: 'float（32ビット）' },
            { value: 64, label: 'double（64ビット）' },
          ]}
        />
        <button type="button" className="btn btn-ghost" onClick={() => setInput('0.1 + 0.2')}>
          0.1 + 0.2 の例
        </button>
      </div>
      <input
        aria-label="小数、または2つの数の四則演算"
        className="input mono"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder="0.1 / 1e-3 / 0.1 + 0.2"
      />
      {result && !result.ok && <ErrorText message={result.error} />}
      {result?.ok && <FloatTable parts={result.parts} />}
      <p className="hint">
        0.1 のように2進数で割り切れない小数は、最も近い値に丸めて格納されます。0.1 + 0.2 が 0.3 ではなく
        0.30000000000000004 になるのは、丸めた値どうしを足すためです。
      </p>
    </div>
  );
}

function FloatTable({ parts }: { parts: ReturnType<typeof floatParts> }) {
  return (
    <>
      <p className="float-bits mono" aria-label="ビット列（符号部・指数部・仮数部）">
        <span className="fb-sign">{parts.sign}</span> <span className="fb-exp">{parts.exponentBits}</span>{' '}
        <span className="fb-mant">{parts.mantissaBits}</span>
      </p>
      <table className="kv">
        <tbody>
          <tr>
            <th>値</th>
            <td className="mono">{Object.is(parts.value, -0) ? '-0' : String(parts.value)}</td>
          </tr>
          <tr>
            <th>種類</th>
            <td>{parts.kind}</td>
          </tr>
          <tr>
            <th className="fb-sign">符号部</th>
            <td className="mono">
              {parts.sign}（{parts.sign ? '負' : '正'}）
            </td>
          </tr>
          <tr>
            <th className="fb-exp">指数部</th>
            <td className="mono">
              {parts.exponentBits}
              {parts.exponent !== null && `（2^${parts.exponent}）`}
            </td>
          </tr>
          <tr>
            <th className="fb-mant">仮数部</th>
            <td className="mono">{parts.mantissaBits}</td>
          </tr>
          <tr>
            <th>16進数</th>
            <td className="mono">{parts.hex}</td>
          </tr>
          <tr>
            <th>格納される値</th>
            <td className="mono">
              {parts.exact ?? '—'}
              {parts.exact && <CopyButton text={parts.exact} />}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
