import { useMemo } from 'react';
import { Segmented } from '../../components/Segmented';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';
import {
  bitOp,
  formatInteger,
  OP_LABELS,
  parseInteger,
  toSigned,
  toUnsigned,
  type BitOp,
  type Width,
} from './logic';

/** 2つの値のビット演算 */

const isShift = (op: BitOp) => op === 'shl' || op === 'shr' || op === 'ushr';

const OPS = (Object.keys(OP_LABELS) as BitOp[]).map((op) => ({ value: op, label: OP_LABELS[op] }));

export function BitOperation({ a, width, onUseResult }: { a: bigint | null; width: Width; onUseResult: (v: bigint) => void }) {
  const [op, setOp] = usePreference<BitOp>('radix:op', 'and', oneOf('and', 'or', 'xor', 'not', 'shl', 'shr', 'ushr'));
  const [bText, setBText] = useInput('radix:b');

  const result = useMemo(() => {
    /**
     * 上の欄が空・不正のときは、エラーではなく案内を出す（未入力の初期表示からエラーを読み上げない。
     * 不正な値のときは、上の欄のエラーと同じ問題を重ねて知らせない）
     */
    if (a === null) return null;
    if (op !== 'not' && !bText.trim()) return null;
    return attempt(() => {
      const b = op === 'not' ? 0n : parseInteger(bText, 10).value;
      return { b, value: bitOp(op, a, b, width) };
    });
  }, [a, op, bText, width]);

  const bin = (v: bigint) => formatInteger(v, 2, width);
  const signed = (v: bigint) => (width !== 0 ? toSigned(v, width) : v);

  return (
    <div className="panel">
      <div className="toolbar">
        <Segmented<BitOp> label="演算" value={op} onChange={setOp} options={OPS} />
        {op !== 'not' && (
          <label>
            {isShift(op) ? 'シフト量' : 'B'}
            <input
              className="input mono input-num-wide"
              value={bText}
              onChange={(e) => setBText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder={isShift(op) ? '1' : '0xFF / 0b1010 / 255'}
            />
          </label>
        )}
      </div>
      {a === null && <p className="hint">上の欄に値を入力すると、ここで計算します。</p>}
      {result && !result.ok && <ErrorText message={result.error} />}
      {result?.ok && a !== null && (
        <table className="kv">
          <tbody>
            <tr>
              <th>A</th>
              <td className="mono">{bin(toUnsigned(a, width))}</td>
            </tr>
            {op !== 'not' && (
              <tr>
                <th>{isShift(op) ? 'シフト量' : 'B'}</th>
                <td className="mono">{isShift(op) ? String(result.b) : bin(toUnsigned(result.b, width))}</td>
              </tr>
            )}
            <tr>
              <th>{op === 'not' ? 'NOT A' : `A ${OP_LABELS[op]} ${isShift(op) ? result.b : 'B'}`}</th>
              <td className="mono">{bin(result.value)}</td>
            </tr>
            <tr>
              <th>結果</th>
              <td className="mono">
                {formatInteger(result.value, 16, width)}（16進数）／ {formatInteger(signed(result.value), 10, 0)}（10進数）
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {result?.ok && (
        <p>
          <button type="button" className="btn btn-ghost" onClick={() => onUseResult(signed(result.value))}>
            結果を上の欄に入れる
          </button>
        </p>
      )}
    </div>
  );
}
