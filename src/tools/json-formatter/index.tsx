import { useMemo, useState } from 'react';
import { Pane } from '../../components/Pane';
import { Notice } from '../../components/Notice';
import { CalculationStatus } from '../../components/CalculationStatus';
import { FormattedOutput } from '../../components/FormattedOutput';
import { LargeTextInput } from '../../components/LargeTextInput';
import { ToolShell } from '../../components/ToolShell';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { isBoolean, oneOf } from '../../lib/settings';
import { useCalculation } from '../../hooks/useCalculation';
import type { JsonIndent } from './logic';
import { ErrorBox } from '../../components/ErrorMessage';
import { Check } from '../../components/Check';

const SAMPLE = '{"user":{"id":1,"name":"山田太郎","roles":["admin","dev"]},"active":true}';

export default function JsonFormatter() {
  const [input, setInput] = useInput('json');
  const [inputRevision, setInputRevision] = useState(0);
  const replaceInput = (value: string) => {
    setInput(value);
    setInputRevision((revision) => revision + 1);
  };
  const [indent, setIndent] = usePreference<JsonIndent>('json:indent', 2, oneOf<JsonIndent>(2, 4, 'tab', 'minify'));
  const [sortKeys, setSortKeys] = usePreference('json:sort', false, isBoolean);

  const request = useMemo(() => ({ tool: 'json' as const, input, indent, sortKeys }), [input, indent, sortKeys]);
  const calculation = useCalculation(request);
  const result = calculation.result;

  return (
    <ToolShell
      description="貼り付けると自動で整形します。大きな整数や小数の表記、エスケープは元のまま保ちます。構文エラーは位置と原因を表示します。"
    >
      <div className="toolbar">
        <label>
          インデント
          <select
            value={String(indent)}
            onChange={(e) => {
              const v = e.target.value;
              setIndent(v === 'tab' || v === 'minify' ? v : (Number(v) as 2 | 4));
            }}
          >
            <option value="2">2スペース</option>
            <option value="4">4スペース</option>
            <option value="tab">タブ</option>
            <option value="minify">圧縮（1行）</option>
          </select>
        </label>
        <Check label="キーをソート" checked={sortKeys} onChange={setSortKeys} />
        <button type="button" className="btn btn-ghost" onClick={() => replaceInput(SAMPLE)}>
          サンプル
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => replaceInput('')}>
          クリア
        </button>
      </div>

      <CalculationStatus {...calculation} />
      <div className="split">
        <Pane title="入力">
          <LargeTextInput
            label="入力"
            value={input}
            onChange={setInput}
            resetKey={inputRevision}
            placeholder='{"key": "value"}'
          />
        </Pane>
        <Pane>
          {result?.ok ? (
            <>
              <FormattedOutput text={result.output} filename="formatted.json" mime="application/json" />
              {/** 同じ行に同じキーが3回以上あると同じ文言が並ぶため、key に番号を含める */}
              {result.warnings.map((w, i) => (
                <Notice key={`${i}:${w}`} tone="warn" message={w} />
              ))}
            </>
          ) : result ? (
            <ErrorBox
              title="構文エラー"
              detail={result.line !== undefined ? `${result.line}行目 ${result.column}文字目付近` : undefined}
              message={result.error}
              code
            />
          ) : <FormattedOutput text="" filename="formatted.json" mime="application/json" />}
        </Pane>
      </div>
    </ToolShell>
  );
}
