import { useCallback, useEffect, useId, useState } from 'react';
import { Check } from '../../components/Check';
import { CopyButton } from '../../components/CopyButton';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { usePreference } from '../../hooks/usePreference';
import { integerBetween, oneOf } from '../../lib/settings';
import { ErrorBox } from '../../components/ErrorMessage';
import {
  CHARSETS,
  DEFAULT_OPTIONS,
  MAX_LENGTH,
  MIN_LENGTH,
  entropyBits,
  pinEntropyBits,
  generateMany,
  generatePin,
  isPasswordOptions,
  strengthOf,
  validate,
  type PasswordOptions,
} from './logic';

type Mode = 'password' | 'pin';
const COUNTS = [1, 5, 10, 20];

const CLASS_TOGGLES: { key: 'upper' | 'lower' | 'digits' | 'symbols'; label: string; sample: string }[] = [
  { key: 'upper', label: '英大文字', sample: 'A-Z' },
  { key: 'lower', label: '英小文字', sample: 'a-z' },
  { key: 'digits', label: '数字', sample: '0-9' },
  { key: 'symbols', label: '記号', sample: '!#$…' },
];

export default function PasswordGenerator() {
  /** 保存するのは設定だけ。生成したパスワードは保存しない */
  const [mode, setMode] = usePreference<Mode>('password:mode', 'password', oneOf('password', 'pin'));
  const [options, setOptions] = usePreference<PasswordOptions>('password:options', DEFAULT_OPTIONS, isPasswordOptions);
  const [count, setCount] = usePreference('password:count', 5, oneOf(...COUNTS));
  const [pinLength, setPinLength] = usePreference('password:pin', 6, integerBetween(4, 32));
  const [results, setResults] = useState<string[]>([]);
  const symbolInputId = useId();

  const update = (patch: Partial<PasswordOptions>) => setOptions({ ...options, ...patch });

  const error = mode === 'password' ? validate(options) : null;
  const bits = mode === 'password' ? entropyBits(options) : pinEntropyBits(pinLength);
  const strength = strengthOf(bits);

  const regenerate = useCallback(() => {
    if (mode === 'pin') {
      setResults(Array.from({ length: count }, () => generatePin(pinLength)));
    } else if (!validate(options)) {
      setResults(generateMany(options, count));
    } else {
      setResults([]);
    }
  }, [mode, options, count, pinLength]);

  useEffect(regenerate, [regenerate]);

  return (
    <ToolShell
      description="ブラウザの暗号論的乱数（crypto.getRandomValues）で生成します。生成結果は送信も保存もされません。"
    >
      <div className="toolbar">
        <Segmented<Mode>
          label="種類"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'password', label: 'パスワード' },
            { value: 'pin', label: 'PIN（数字のみ）' },
          ]}
        />
        <label>
          生成数
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {COUNTS.map((c) => (
              <option key={c} value={c}>
                {c}個
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={regenerate} disabled={!!error}>
          ↻ 再生成
        </button>
      </div>

      <div className="pw-layout">
        <div className="settings-panel">
          {mode === 'password' ? (
            <>
              <LengthField
                value={options.length}
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                onChange={(length) => update({ length })}
              />

              <fieldset className="fieldset">
                <legend>使用する文字</legend>
                <div className="toggle-grid">
                  {CLASS_TOGGLES.map((t) => (
                    <label key={t.key} className={options[t.key] ? 'toggle on' : 'toggle'}>
                      <input
                        type="checkbox"
                        checked={options[t.key]}
                        onChange={(e) => update({ [t.key]: e.target.checked })}
                      />
                      <span>{t.label}</span>
                      <span className="mono muted">{t.sample}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {options.symbols && (
                /** label の中にボタンを入れると入力欄の名前が正しく付かないため、label は文言だけを囲む */
                <div className="field">
                  <span className="field-label">
                    <label htmlFor={symbolInputId}>使用する記号</label>
                    <button type="button" className="link-btn" onClick={() => update({ symbolSet: CHARSETS.symbols })}>
                      初期値に戻す
                    </button>
                  </span>
                  <input
                    id={symbolInputId}
                    className="input mono"
                    value={options.symbolSet}
                    onChange={(e) => update({ symbolSet: e.target.value })}
                    spellCheck={false}
                  />
                  <span className="hint">サイトによって使える記号が限られる場合に絞り込んでください</span>
                </div>
              )}

              <label className="field">
                <span className="field-label">除外する文字</span>
                <input
                  className="input mono"
                  value={options.exclude}
                  onChange={(e) => update({ exclude: e.target.value })}
                  placeholder="例: xyz"
                  spellCheck={false}
                />
              </label>

              <Check
                label={<>見間違えやすい文字を除く <span className="mono muted">(I l 1 | O 0 o など)</span></>}
                checked={options.excludeAmbiguous}
                onChange={(v) => update({ excludeAmbiguous: v })}
              />
              <Check label="選んだ文字種を必ず1文字以上含める" checked={options.requireEach} onChange={(v) => update({ requireEach: v })} />
            </>
          ) : (
            <LengthField label="桁数" value={pinLength} min={4} max={32} onChange={setPinLength} />
          )}
        </div>

        <div className="pw-results">
          <div className="strength">
            <div className="strength-head">
              <span>
                強度：<strong className={`lv${strength.level}`}>{strength.label}</strong>
              </span>
              <span className="muted mono">約 {Math.floor(bits)} ビット</span>
            </div>
            <div className="meter" aria-hidden="true">
              <div className={`meter-fill lv${strength.level}`} style={{ width: `${Math.min(100, (bits / 128) * 100)}%` }} />
            </div>
          </div>

          {error ? (
            <ErrorBox title="生成できません" message={error} />
          ) : (
            <ul className="pw-list">
              {results.map((p, i) => (
                <li key={`${i}-${p}`} className="value-item">
                  <Highlighted text={p} />
                  <CopyButton text={p} />
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            強度はエントロピー（長さ × log2(文字の種類数)）による目安です。PINは総当たりに弱いため、回数制限のある用途に限って使ってください。
          </p>
        </div>
      </div>
    </ToolShell>
  );
}

function LengthField({
  label = '長さ',
  value,
  min,
  max,
  onChange,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  /** 入力途中（「12」と打つ途中の「1」など）で丸められないよう、範囲内の値になったときだけ反映する */
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const onType = (s: string) => {
    setDraft(s);
    const n = Number(s);
    if (Number.isInteger(n) && n >= min && n <= max) onChange(n);
  };
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="length-row">
        <input
          type="range"
          min={min}
          max={Math.min(max, 64)}
          value={Math.min(value, 64)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        <input
          type="number"
          className="input mono length-num"
          min={min}
          max={max}
          value={draft}
          onChange={(e) => onType(e.target.value)}
          onBlur={() => setDraft(String(value))}
          aria-label={`${label}（数値）`}
        />
      </div>
    </div>
  );
}

/** 数字と記号を色分けして読み取りやすくする */
function Highlighted({ text }: { text: string }) {
  return (
    <span className="value-text mono">
      {[...text].map((c, i) => (
        <span key={i} className={/[0-9]/.test(c) ? 'ch-digit' : /[A-Za-z]/.test(c) ? undefined : 'ch-symbol'}>
          {c}
        </span>
      ))}
    </span>
  );
}
