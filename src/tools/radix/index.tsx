/**
 * 進数変換・ビット演算のファイルの分担。
 * - `logic.ts`：整数の進数変換とビット演算
 * - `float.ts`：IEEE754 の丸め・四則演算・内部表現（整数の処理とは独立させる）
 * - `BitGrid.tsx`・`BitOperation.tsx`・`FloatView.tsx`：ビットの表示・ビット演算・浮動小数点の画面
 */
import { useMemo } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { oneOf } from '../../lib/settings';
import {
  BASE_NAMES,
  BASES,
  bytesOf,
  formatInteger,
  parseInteger,
  plainInteger,
  toggleBit,
  toSigned,
  toUnsigned,
  type Base,
  type Width,
} from './logic';
import { BitGrid } from './BitGrid';
import { BitOperation } from './BitOperation';
import { FloatView } from './FloatView';
import { ErrorText } from '../../components/ErrorMessage';
import { attempt } from '../../lib/errors';

const WIDTHS: { value: Width; label: string }[] = [
  { value: 8, label: '8ビット' },
  { value: 16, label: '16ビット' },
  { value: 32, label: '32ビット' },
  { value: 64, label: '64ビット' },
  { value: 0, label: '制限なし' },
];


export default function RadixTool() {
  const [text, setText] = useInput('radix:text');
  const [sourceText, setSourceText] = useInput('radix:base', '10');
  const [width, setWidth] = usePreference<Width>('radix:width', 32, oneOf(0, 8, 16, 32, 64));
  /** 保存値を手で書き換えられても、対応する基数（2・8・10・16）以外は10進数として扱う（「7」で英語の例外の文言が出ないように） */
  const source: Base = BASES.find((b) => String(b) === sourceText) ?? 10;

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return attempt(() => {
      const { value, base } = parseInteger(text, source);
      return { value, base, unsigned: toUnsigned(value, width) };
    });
  }, [text, source, width]);

  const edit = (base: Base, value: string) => {
    setSourceText(String(base));
    setText(value);
  };

  /** 計算した値を、今の入力欄（の進数）に書き戻す */
  const setValue = (value: bigint) => {
    const base = parsed?.ok ? parsed.base : source;
    edit(base, plainInteger(value, base));
  };

  const shown = (base: Base) => {
    if (base === source) return text;
    if (!parsed?.ok) return '';
    /** 幅があれば、2・8・16進数はビット列（符号なし）で、10進数は入力が負なら負のまま表示する */
    const v = width > 0 && !(base === 10 && parsed.value < 0n) ? parsed.unsigned : parsed.value;
    return formatInteger(v, base, base === 10 ? 0 : width);
  };

  return (
    <ToolShell
      description="2・8・10・16進数の相互変換、2の補数とバイト順、ビット演算、浮動小数点の内部表現。0x・0b・0o の接頭辞と、区切りの空白・_ に対応します。"
    >
      <div className="toolbar">
        <Segmented<Width> label="ビット幅" value={width} onChange={setWidth} options={WIDTHS} />
        {/** 負の数を入れ、2の補数・符号なしの値も見せる */}
        <button type="button" className="btn btn-ghost" onClick={() => edit(10, '-42')}>サンプル</button>
      </div>

      <div className="radix-fields">
        {BASES.map((base) => (
          <div key={base} className="field">
            <span className="field-label">
              {BASE_NAMES[base]}
              {base === source && parsed?.ok && parsed.base !== source && (
                <span className="muted">{BASE_NAMES[parsed.base]}として読みました</span>
              )}
            </span>
            <span className="input-row">
              <input
                aria-label={BASE_NAMES[base]}
                className="input mono"
                value={shown(base)}
                onChange={(e) => edit(base, e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder={base === 10 ? '255 / -1 / 0xFF' : ''}
              />
              <CopyButton text={shown(base).replace(/[ ,]/g, '')} />
            </span>
          </div>
        ))}
      </div>
      {parsed && !parsed.ok && <ErrorText message={parsed.error} />}

      {parsed?.ok && width !== 0 && (
        <>
          <table className="kv">
            <tbody>
              <tr>
                <th>符号付き</th>
                <td className="mono">{formatInteger(toSigned(parsed.unsigned, width), 10, 0)}</td>
              </tr>
              <tr>
                <th>符号なし</th>
                <td className="mono">{formatInteger(parsed.unsigned, 10, 0)}</td>
              </tr>
              <tr>
                <th>ビッグエンディアン</th>
                <td className="mono">{bytesOf(parsed.unsigned, width).join(' ')}</td>
              </tr>
              <tr>
                <th>リトルエンディアン</th>
                <td className="mono">{bytesOf(parsed.unsigned, width).reverse().join(' ')}</td>
              </tr>
            </tbody>
          </table>
          <BitGrid
            unsigned={parsed.unsigned}
            width={width}
            onToggle={(i) => {
              const next = toggleBit(parsed.unsigned, i);
              /** 負の数で入力していたら、符号付きのまま書き戻す */
              setValue(parsed.value < 0n ? toSigned(next, width) : next);
            }}
          />
        </>
      )}

      <h2 className="section-title">ビット演算</h2>
      <BitOperation a={parsed?.ok ? parsed.value : null} width={width} onUseResult={setValue} />

      <h2 className="section-title">浮動小数点の内部表現</h2>
      <FloatView />
    </ToolShell>
  );
}

