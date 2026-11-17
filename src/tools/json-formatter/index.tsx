/**
 * JSON整形のファイルの分担。
 * - `logic.ts`：整形・圧縮（計算 Worker で実行する。値の表記は変えない）
 * - `tree.ts`：ツリー表示の計算（値の場所の組み立てと、子の切り出し）
 * - `TreeView.tsx`：ツリーの表示（開いた子だけを描画し、パスと値をコピーできる）
 * 構文木（元の表記を保つ解析）は src/lib/jsonTree.ts にある。
 */
import { useEffect, useMemo, useState } from 'react';
import { Pane } from '../../components/Pane';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
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
import { Segmented } from '../../components/Segmented';
import { attempt } from '../../lib/errors';
import { parseJsonTree } from '../../lib/jsonTree';
import { formatNumber } from '../../lib/number';
import { MAX_TREE_INPUT } from './tree';
import { takeHandoff } from '../../lib/handoff';
import { TreeView } from './TreeView';

type View = 'text' | 'tree';

const SAMPLE = '{"user":{"id":1,"name":"山田太郎","roles":["admin","dev"]},"active":true}';

export default function JsonFormatter() {
  const [input, setInput] = useInput('json');
  const [inputRevision, setInputRevision] = useState(0);
  const replaceInput = (value: string) => {
    setInput(value);
    setInputRevision((revision) => revision + 1);
  };
  /** ほかのツールの「JSON整形で開く」から渡された値を、開いたときに1回だけ入れる（src/lib/handoff.ts） */
  useEffect(() => {
    const received = takeHandoff('json');
    if (received !== null) replaceInput(received);
  }, []);
  const [indent, setIndent] = usePreference<JsonIndent>('json:indent', 2, oneOf<JsonIndent>(2, 4, 'tab', 'minify'));
  const [sortKeys, setSortKeys] = usePreference('json:sort', false, isBoolean);
  const [view, setView] = usePreference<View>('json:view', 'text', oneOf<View>('text', 'tree'));

  const request = useMemo(() => ({ tool: 'json' as const, input, indent, sortKeys }), [input, indent, sortKeys]);
  const calculation = useCalculation(request);
  const result = calculation.result;
  /**
   * ツリーは、ツリーの表示を選んだときだけ、画面の側で解析する（上限は MAX_TREE_INPUT）。
   * 構文エラーは整形（Worker）の側で表示するため、ここでは解析できたときだけツリーを出す
   */
  const treeTooLarge = input.length > MAX_TREE_INPUT;
  const tree = useMemo(() => {
    if (view !== 'tree' || treeTooLarge || !input.trim()) return null;
    return attempt(() => ({ root: parseJsonTree(input).root }));
  }, [view, treeTooLarge, input]);

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
        <Segmented<View>
          label="表示"
          value={view}
          onChange={setView}
          options={[
            { value: 'text', label: 'テキスト' },
            { value: 'tree', label: 'ツリー' },
          ]}
        />
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
            limit={MAX_CALCULATION_INPUT}
            placeholder='{"key": "value"}'
          />
        </Pane>
        <Pane>
          {result?.ok ? (
            <>
              {view === 'tree' && treeTooLarge && (
                <Notice tone="warn">
                  ツリーは {formatNumber(MAX_TREE_INPUT)} 文字までの入力で表示します。整形した結果をテキストで表示しています。
                </Notice>
              )}
              {view === 'tree' && tree?.ok ? (
                <TreeView root={tree.root} />
              ) : (
                <FormattedOutput text={result.output} filename="formatted.json" mime="application/json" />
              )}
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
