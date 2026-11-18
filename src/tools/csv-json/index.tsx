/**
 * CSV ⇔ JSON のファイルの分担。
 * - `parseCsv.ts`：CSV の構文解析
 * - `writeCsv.ts`：JSON からの CSV の出力
 * - `validateJson.ts`：列へ展開する前に、JSONの各オブジェクトの重複キーを拒否
 * - `logic.ts`：CSV から JSON への変換
 * - `csvFormat.ts`：両方向で共通の形式（区切り文字・セル数と出力の上限）
 * - `fileOptions.ts`：ファイル名から変換の方向と区切り文字を選ぶ
 * - `calculation.ts`：計算 Worker で、要求の方向に変換して画面に返す形にする
 * - `useCsvJson.ts`：画面の状態（入力・変換の向きと設定・ファイルの読み込み）と計算の結果をまとめるフック
 * 画面・Worker・テストは、それぞれの定義元を直接読み込む。両方向を組み合わせる検査は `roundTrip.test.ts` にある。
 */
import { useRef } from 'react';
import { MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { Pane } from '../../components/Pane';
import { Check } from '../../components/Check';
import { Notice } from '../../components/Notice';
import { CopyButton } from '../../components/CopyButton';
import { CalculationStatus } from '../../components/CalculationStatus';
import { LargeTextInput } from '../../components/LargeTextInput';
import { Segmented } from '../../components/Segmented';
import { ToolShell } from '../../components/ToolShell';
import { downloadText, type TextEncodingName } from '../../lib/file';
import { TextOutputPreview } from '../../components/FormattedOutput';
import { ErrorBox } from '../../components/ErrorMessage';
import { type Delimiter } from './csvFormat';
import type { Direction } from './fileOptions';
import { OpenInToolButton } from '../../components/OpenInToolButton';
import { useCsvJson } from './useCsvJson';

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'カンマ' },
  { value: '\t', label: 'タブ' },
  { value: ';', label: 'セミコロン' },
  { value: '|', label: 'パイプ' },
];

const SAMPLE_CSV = `社員番号,氏名,部署,入社日,在籍
00123,山田 太郎,開発部,2015-04-01,true
00456,"佐藤, 花子",営業部,2019-10-01,true
00789,鈴木 一郎,"総務部
（兼 経理）",2008-04-01,false`;

export default function CsvJson() {
  const {
    direction, setDirection, input, replaceInput, resetInput, inputRevision, fileLoader,
    csvOptions, setCsvOptions, jsonOptions, setJsonOptions, encoding, setEncoding, bom, setBom,
    calculation, result, swapTooLarge, swap,
  } = useCsvJson();
  const fileRef = useRef<HTMLInputElement>(null);

  const download = () => {
    if (!result) return;
    if (direction === 'csv2json') downloadText('data.json', result.output, 'application/json');
    else downloadText(jsonOptions.delimiter === '\t' ? 'data.tsv' : 'data.csv', result.output, 'text/csv', bom);
  };

  return (
    <ToolShell
      description="ダブルクォート内のカンマや改行に対応（RFC 4180）。「00123」のような先頭0の値は文字列のまま残します。"
    >
      <div className="toolbar">
        <Segmented<Direction>
          label="変換の向き"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'csv2json', label: 'CSV → JSON' },
            { value: 'json2csv', label: 'JSON → CSV' },
          ]}
        />
        <button type="button" className="btn btn-ghost" onClick={swap} disabled={!result || swapTooLarge} title="出力を入力に移して向きを反転">
          ⇄ 入れ替え
        </button>
        {swapTooLarge && <span className="hint">変換結果が逆方向の入力上限を超えています</span>}
        <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          ファイルを開く
        </button>
        <select value={encoding} onChange={(e) => setEncoding(e.target.value as TextEncodingName)} aria-label="ファイルの文字コード">
          <option value="utf-8">UTF-8</option>
          <option value="shift_jis">Shift_JIS（Excel）</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.json"
          className="visually-hidden"
          /** 「ファイルを開く」ボタンから開くので、見えない入力欄自体には Tab で止まらないようにする */
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void fileLoader.pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setDirection('csv2json');
            resetInput(SAMPLE_CSV);
          }}
        >
          サンプル
        </button>
      </div>

      {fileLoader.error && <ErrorBox alert message={fileLoader.error} />}
      <div className="option-row">
        <label>
          区切り文字
          <select
            value={direction === 'csv2json' ? csvOptions.delimiter : jsonOptions.delimiter}
            onChange={(e) => {
              const d = e.target.value as Delimiter;
              if (direction === 'csv2json') setCsvOptions({ ...csvOptions, delimiter: d });
              else setJsonOptions({ ...jsonOptions, delimiter: d });
            }}
          >
            {DELIMITERS.map((d) => (
              <option key={d.label} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {direction === 'csv2json' ? (
          <>
            <Check label="1行目は項目名" checked={csvOptions.header} onChange={(v) => setCsvOptions({ ...csvOptions, header: v })} />
            <Check label="数値・真偽値に変換" checked={csvOptions.inferTypes} onChange={(v) => setCsvOptions({ ...csvOptions, inferTypes: v })} />
            <Check label="空行を飛ばす" checked={csvOptions.skipEmptyLines} onChange={(v) => setCsvOptions({ ...csvOptions, skipEmptyLines: v })} />
            <Check
              label="区切り後の空白を無視"
              checked={csvOptions.skipInitialSpace}
              onChange={(v) => setCsvOptions({ ...csvOptions, skipInitialSpace: v })}
            />
            <label>
              インデント
              <select value={csvOptions.indent} onChange={(e) => setCsvOptions({ ...csvOptions, indent: Number(e.target.value) })}>
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={0}>圧縮</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <Check label="項目名の行を出力" checked={jsonOptions.header} onChange={(v) => setJsonOptions({ ...jsonOptions, header: v })} />
            <Check label="入れ子を列に展開" checked={jsonOptions.flatten} onChange={(v) => setJsonOptions({ ...jsonOptions, flatten: v })} />
            <Check label="すべてクォート" checked={jsonOptions.quoteAll} onChange={(v) => setJsonOptions({ ...jsonOptions, quoteAll: v })} />
            <Check
              label="数式を無効化（Excel対策）"
              checked={jsonOptions.escapeFormulas}
              onChange={(v) => setJsonOptions({ ...jsonOptions, escapeFormulas: v })}
            />
            <label>
              改行
              <select value={jsonOptions.newline} onChange={(e) => setJsonOptions({ ...jsonOptions, newline: e.target.value as '\n' | '\r\n' })}>
                <option value={'\r\n'}>CRLF（Windows）</option>
                <option value={'\n'}>LF</option>
              </select>
            </label>
          </>
        )}
      </div>

      <CalculationStatus {...calculation} />
      <div className="split">
        <Pane
          title={direction === 'csv2json' ? 'CSV' : 'JSON'}
          actions={<button type="button" className="link-btn" onClick={() => resetInput('')}>クリア</button>}
        >
          <LargeTextInput limit={MAX_CALCULATION_INPUT}
            label={`入力（${direction === 'csv2json' ? 'CSV' : 'JSON'}）`}
            value={input}
            onChange={replaceInput}
            preserveLineEndings
            resetKey={inputRevision}
          />
        </Pane>
        <Pane
          title={
            <span>
              {direction === 'csv2json' ? 'JSON' : 'CSV'}
              {result && <span className="muted pane-sub">{result.summary}</span>}
            </span>
          }
          actions={result && <>
            {direction === 'json2csv' && (
              <Check small title="Excel で開いたときの文字化けを防ぎます" label="BOM付き" checked={bom} onChange={setBom} />
            )}
            <button type="button" className="btn btn-ghost" onClick={download}>
              保存
            </button>
            {direction === 'csv2json' && <OpenInToolButton to="json" text={result.output} limit={MAX_CALCULATION_INPUT} />}
            <CopyButton text={result.output} />
          </>}
        >
          <TextOutputPreview label={`出力（${direction === 'csv2json' ? 'JSON' : 'CSV'}）`} text={result?.output ?? ''} canSave />
          {result && result.warnings.map((w) => <Notice key={w} tone="warn" message={w} />)}
        </Pane>
      </div>
    </ToolShell>
  );
}
