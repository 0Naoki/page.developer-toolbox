/**
 * テキスト差分のファイルの分担。
 * - `myers.ts`：列の差分の計算（Myers 法）と、時間での打ち切り。テキストに依存しない
 * - `logic.ts`：行・文字の差分（改行の扱い、空白・大文字小文字の無視、行内の強調）
 * - `rows.ts`：左右表示・統合表示の行の型
 * - `unified.ts`：コピー用の unified 形式のパッチの生成（元の改行を保つ）
 * - `packed.ts`：本文量・行数から入力参照と行の直接保持を選ぶ Worker の応答
 * - `preview.ts`：圧縮した応答から、表示する範囲だけを復元
 * - `calculation.ts`：計算 Worker で差分と unified 形式をまとめて求める
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pane } from '../../components/Pane';
import { Badge } from '../../components/Badge';
import { Notice } from '../../components/Notice';
import { CalculationStatus } from '../../components/CalculationStatus';
import { CopyButton } from '../../components/CopyButton';
import { LargeTextInput } from '../../components/LargeTextInput';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { useCalculation } from '../../hooks/useCalculation';
import { useInput } from '../../hooks/useInput';
import { usePreference } from '../../hooks/usePreference';
import { isBoolean, oneOf } from '../../lib/settings';
import { textPreview } from '../../lib/text/textPreview';
import type { DiffCalculation } from './calculation';
import type { DiffLine } from './logic';
import type { FoldedRow, UnifiedDisplayRow } from './rows';
import { splitPreview, unifiedPreview } from './preview';
import { formatNumber } from '../../lib/number';
import { Check } from '../../components/Check';

type View = 'split' | 'unified';

/** 一度に描画する行数（数万行を一度に描画すると画面が固まるため） */
const RENDER_STEP = 1000;
/** 改行がない長い入力でも、1セルに全文を描画しない。 */
const LINE_PREVIEW_LIMIT = 2_000;

const SAMPLE_BEFORE = `SELECT id, name, price
FROM products
WHERE category = 'book'
ORDER BY price;`;
const SAMPLE_AFTER = `SELECT id, name, price, stock
FROM products
WHERE category = 'book'
  AND stock > 0
ORDER BY price DESC;`;

const EMPTY_RESULT: DiffCalculation = { rows: { blocks: [], before: '', after: '', leftStarts: new Uint32Array(), rightStarts: new Uint32Array(), length: 0 }, added: 0, removed: 0, identical: true, approximate: false, unified: '' };

export default function TextDiff() {
  const [before, setBefore] = useInput('diff:before');
  const [after, setAfter] = useInput('diff:after');
  const [view, setView] = usePreference<View>('diff:view', 'split', oneOf('split', 'unified'));
  const [ignoreWhitespace, setIgnoreWhitespace] = usePreference('diff:ws', false, isBoolean);
  const [ignoreCase, setIgnoreCase] = usePreference('diff:case', false, isBoolean);
  const [onlyChanges, setOnlyChanges] = usePreference('diff:fold', true, isBoolean);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [renderLimit, setRenderLimit] = useState(RENDER_STEP);

  const request = useMemo(
    () => ({ tool: 'diff' as const, input: before, after, ignoreWhitespace, ignoreCase }),
    [before, after, ignoreWhitespace, ignoreCase],
  );
  const calculation = useCalculation(request);
  /**
   * 計算中は前の結果を残し、入力のたびに表示が消えて画面が跳ねないようにする。
   * 中断・失敗のときは保持している結果も捨て、次の計算中に一度消した古い結果を出し直さない
   */
  const [kept, setKept] = useState<DiffCalculation>(EMPTY_RESULT);
  const nextKept = calculation.result ?? (calculation.state === 'cancelled' || calculation.state === 'error' ? EMPTY_RESULT : kept);
  /** 前の描画から持ち越す値なので、変わったときは描画中に state を更新する（ref を描画中に書き換えない） */
  if (nextKept !== kept) setKept(nextKept);
  const result = calculation.state === 'pending' || calculation.state === 'done' ? nextKept : EMPTY_RESULT;

  /** 比較結果が変わったら、描画する行数を最初に戻す。展開した箇所も閉じる（位置は前の結果の行番号で、新しい結果では別の行を指すため） */
  useEffect(() => {
    setRenderLimit(RENDER_STEP);
    setExpanded([]);
  }, [result]);

  const preview = useMemo(() => {
    const options = { onlyChanges, context: 3, expanded, limit: renderLimit };
    return view === 'split'
      ? { view: 'split' as const, ...splitPreview(result.rows, options) }
      : { view: 'unified' as const, ...unifiedPreview(result.rows, options) };
  }, [result, onlyChanges, expanded, renderLimit, view]);
  const totalRows = preview.total;

  const swap = () => {
    setBefore(after);
    setAfter(before);
  };

  const hasInput = before !== '' || after !== '';

  return (
    <ToolShell description="行単位で比較し、変更された行の中で違う文字を強調します。">
      <div className="toolbar">
        <Segmented<View>
          label="表示方法"
          value={view}
          onChange={setView}
          options={[
            { value: 'split', label: '左右に並べる' },
            { value: 'unified', label: '1列にまとめる' },
          ]}
        />
        <Check label="空白の違いを無視" checked={ignoreWhitespace} onChange={setIgnoreWhitespace} />
        <Check label="大文字小文字を無視" checked={ignoreCase} onChange={setIgnoreCase} />
        <Check
          label="変更箇所の周辺だけ表示"
          checked={onlyChanges}
          onChange={(v) => {
            setOnlyChanges(v);
            setExpanded([]);
          }}
        />
        <button type="button" className="btn btn-ghost" onClick={swap}>
          ⇄ 左右を入れ替え
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setBefore(SAMPLE_BEFORE);
            setAfter(SAMPLE_AFTER);
          }}
        >
          サンプル
        </button>
      </div>

      <div className="split">
        <Pane title="変更前" actions={<button type="button" className="link-btn" onClick={() => setBefore('')}>クリア</button>}>
          <LargeTextInput label="変更前" className="code code-mid" value={before} onChange={setBefore} preserveLineEndings />
        </Pane>
        <Pane title="変更後" actions={<button type="button" className="link-btn" onClick={() => setAfter('')}>クリア</button>}>
          <LargeTextInput label="変更後" className="code code-mid" value={after} onChange={setAfter} preserveLineEndings />
        </Pane>
      </div>

      {hasInput && (
        <>
          <CalculationStatus {...calculation} />
          <div className="diff-result">
            <div className="diff-summary">
              {calculation.state !== 'done' ? null : result.identical ? (
                <Badge tone="good">差分はありません</Badge>
              ) : (
                <>
                  <Badge tone="add">+{result.added} 行</Badge>
                  <Badge tone="del">−{result.removed} 行</Badge>
                </>
              )}
              <span className="spacer" />
              {/** 計算中に表示している前の結果は、今の入力の差分ではないためコピーさせない */}
              {!result.identical && <CopyButton text={calculation.state === 'done' ? result.unified : ''} label="unified形式でコピー" />}
            </div>

            {result.approximate && (
              <Notice tone="warn" className="diff-notice">
                差分が大きいため、一部は「まとめて削除・追加」として簡略化して表示しています（内容は正しく、最小の差分ではありません）。
              </Notice>
            )}
            {!result.identical && (
              <div className="diff-scroll">
                <table className={`diff-table view-${view}`}>
                  <tbody>
                    {preview.view === 'split'
                      ? preview.shown.map((r, i) => <SplitRow key={i} row={r} onExpand={(from) => setExpanded([...expanded, from])} />)
                      : preview.shown.map((u, i) => <UnifiedRow key={i} item={u} onExpand={(from) => setExpanded([...expanded, from])} />)}
                  </tbody>
                </table>
                {totalRows > renderLimit && (
                  <div className="diff-more">
                    <button type="button" className="btn btn-ghost" onClick={() => setRenderLimit(renderLimit + RENDER_STEP * 5)}>
                      さらに表示（残り {formatNumber(totalRows - renderLimit)} 行）
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </ToolShell>
  );
}

function LineText({ line, kind }: { line?: DiffLine; kind?: 'del' | 'add' }) {
  if (!line) return null;
  const preview = textPreview(line.text, LINE_PREVIEW_LIMIT);
  let content: ReactNode = preview || ' ';
  if (line.segments && kind) {
    const parts: ReactNode[] = [];
    let remaining = preview.length;
    for (const [index, segment] of line.segments.entries()) {
      if (remaining === 0) break;
      const text = segment.text.slice(0, remaining);
      remaining -= text.length;
      parts.push(segment.changed
        ? <mark key={index} className={`diff-mark ${kind}`}>{text}</mark>
        : <Fragment key={index}>{text}</Fragment>);
    }
    content = parts;
  }
  return (
    <>
      {content}
      {preview.length < line.text.length && <span className="muted">（以降省略）</span>}
    </>
  );
}

function FoldCell({ count, from, colSpan, onExpand }: { count: number; from: number; colSpan: number; onExpand: (from: number) => void }) {
  return (
    <tr className="diff-fold">
      <td colSpan={colSpan}>
        <button type="button" className="link-btn" onClick={() => onExpand(from)}>
          ⋯ 変更のない {count} 行を表示
        </button>
      </td>
    </tr>
  );
}

function SplitRow({ row, onExpand }: { row: FoldedRow; onExpand: (from: number) => void }) {
  if (row.kind === 'fold') return <FoldCell count={row.count} from={row.from} colSpan={4} onExpand={onExpand} />;
  if (row.kind === 'equal') {
    return (
      <tr>
        <td className="ln">{row.left.no}</td>
        <td className="tx"><LineText line={row.left} /></td>
        <td className="ln">{row.right.no}</td>
        <td className="tx"><LineText line={row.right} /></td>
      </tr>
    );
  }
  return (
    <tr>
      <td className={row.left ? 'ln del' : 'ln empty'}>{row.left?.no}</td>
      <td className={row.left ? 'tx del' : 'tx empty'}>
        <LineText line={row.left} kind="del" />
      </td>
      <td className={row.right ? 'ln add' : 'ln empty'}>{row.right?.no}</td>
      <td className={row.right ? 'tx add' : 'tx empty'}>
        <LineText line={row.right} kind="add" />
      </td>
    </tr>
  );
}

function UnifiedRow({ item, onExpand }: { item: UnifiedDisplayRow; onExpand: (from: number) => void }) {
  if (item.kind === 'fold') return <FoldCell count={item.count} from={item.from} colSpan={4} onExpand={onExpand} />;
  const cls = item.kind === 'equal' ? '' : item.kind;
  const sign = item.kind === 'add' ? '+' : item.kind === 'del' ? '−' : ' ';
  return (
    <tr>
      <td className={`ln ${cls}`}>{item.aNo}</td>
      <td className={`ln ${cls}`}>{item.bNo}</td>
      <td className={`sign ${cls}`}>{sign}</td>
      <td className={`tx ${cls}`}>
        <LineText line={item.line} kind={item.kind === 'equal' ? undefined : item.kind} />
      </td>
    </tr>
  );
}
