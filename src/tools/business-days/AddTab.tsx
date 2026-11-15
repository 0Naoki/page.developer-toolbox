import { useMemo } from 'react';
import { useInput } from '../../hooks/useInput';
import { formatYmd, parseYmd, type Ymd } from '../../lib/time/date';
import { addBusinessDays, dayInfo, type Calendar } from './logic';
import { DateInput, withDow } from './tabFields';
import { attempt } from '../../lib/errors';
import { ErrorText } from '../../components/ErrorMessage';

export function AddTab({ cal, today }: { cal: Calendar; today: Ymd }) {
  const [base, setBase] = useInput('bizdays:base', formatYmd(today));
  const [nText, setNText] = useInput('bizdays:n', '5');

  const r = useMemo(
    () =>
      attempt(() => {
        const n = Number(nText);
        if (nText.trim() === '' || !Number.isInteger(n)) throw new Error('営業日数を整数で入力してください（前にさかのぼる場合はマイナス）');
        const b = parseYmd(base);
        return { result: addBusinessDays(b, n, cal), info: dayInfo(b, cal), n };
      }),
    [base, nText, cal],
  );

  return (
    <>
      <div className="input-grid">
        <DateInput label="基準日" value={base} onChange={setBase} />
        <label className="field">
          <span className="field-label">営業日数（マイナスで前）</span>
          <input className="input mono" inputMode="numeric" value={nText} onChange={(e) => setNText(e.target.value)} />
        </label>
      </div>
      {!r.ok && <ErrorText message={r.error} />}
      {r.ok && (
        <>
          <p className="big-result">
            <strong className="mono">{withDow(r.result)}</strong>
          </p>
          <p className="hint">
            基準日{r.info.business ? 'は営業日' : `は休み（${r.info.reason}）`}です。基準日自体は数えません。
            {r.n === 0 && '0 を指定すると、基準日が休みの場合に次の営業日を返します。'}
          </p>
        </>
      )}
    </>
  );
}
