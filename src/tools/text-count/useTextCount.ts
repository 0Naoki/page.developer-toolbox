import { useMemo, useState } from 'react';
import { useInput } from '../../hooks/useInput';
import { useFileLoader } from '../../hooks/useFileLoader';
import { usePreference } from '../../hooks/usePreference';
import { useCalculation } from '../../hooks/useCalculation';
import { isBoolean, oneOf } from '../../lib/settings';
import { MAX_CALCULATION_FILE_BYTES, MAX_CALCULATION_INPUT, MAX_CALCULATION_INPUT_LABEL } from '../../lib/worker/calculationLimits';
import type { Newline } from './count';
import { decodeInspectionFile } from './invisible';
import { analysisOf, MEASURES, type Measure } from './logic';

/** 結果の表示の切り替え（文字数・不可視文字・桁あふれ） */
export type View = 'counts' | 'invisible' | 'lines';

/** 行の上限は空欄か、丸めずに扱える非負の整数。 */
function isLineLimit(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))));
}

/**
 * 文字数・バイト数の画面の状態（入力・表示設定・ファイルの読み込み・桁あふれのページ）と、計算の結果。
 *
 * @remarks
 * 全文の集計は、入力・改行・計測方法が変わったときだけ Worker で行う。ページ・上限・超過行だけの表示を変えたときは、
 * 集計済みの行から1ページ分を切り出し直すだけにする（{@link analysisOf}）。
 * 行の一覧の見え方を変える操作（入力・計測方法・上限・超過行だけの表示の変更）では、ページを先頭に戻す。
 * 入力は sessionStorage に保存し（useInput）、表示設定は localStorage に保存する（usePreference）。
 */
export function useTextCount() {
  const [text, setText] = useInput('count');
  const [newline, setNewline] = usePreference<Newline>('count:newline', 'none', oneOf('lf', 'crlf', 'none'));
  const [measure, saveMeasure] = usePreference<Measure>('count:measure', 'sjis', oneOf(...MEASURES.map(({ value }) => value)));
  const [limitText, saveLimitText] = usePreference('count:limit', '', isLineLimit);
  const [onlyOver, saveOnlyOver] = usePreference('count:onlyOver', false, isBoolean);
  const [view, setView] = usePreference<View>('count:view', 'counts', oneOf('counts', 'invisible', 'lines'));
  const [page, setPage] = useState(0);
  /** 入力欄の編集履歴を作り直す番号。クリア・サンプル・ファイルの読み込みで、前の入力に戻れないようにする */
  const [inputRevision, setInputRevision] = useState(0);

  const fileLoader = useFileLoader({
    limit: MAX_CALCULATION_FILE_BYTES,
    tooLargeHint: '。分割して読み込んでください。',
    decode: (bytes) => {
      const value = decodeInspectionFile(bytes);
      if (value.length > MAX_CALCULATION_INPUT) throw new Error('文字数の上限');
      return value;
    },
    /** 読めなかったときは共通の文言、読めた後に UTF-8 として不正か文字数の上限を超えたときは、その確認を案内する */
    decodeErrorMessage: () => `ファイルを読み込めません。UTF-8のファイルか、${MAX_CALCULATION_INPUT_LABEL}の上限以内かを確認してください。`,
    onLoaded: (value) => {
      setText(value);
      setInputRevision((revision) => revision + 1);
      setPage(0);
    },
  });

  /** 入力欄での編集。読み込み中・読み込んだファイルの結果は破棄する */
  const replaceInput = (value: string) => {
    fileLoader.clear();
    setText(value);
    setPage(0);
  };
  /** クリア・サンプルで入力を置き換える。編集履歴も作り直す */
  const resetInput = (value: string) => {
    replaceInput(value);
    setInputRevision((revision) => revision + 1);
  };

  const invalidLimit = !isLineLimit(limitText);
  const limit = limitText !== '' && !invalidLimit ? Number(limitText) : null;
  const request = useMemo(() => ({ tool: 'count' as const, input: text, newline, measure }), [text, newline, measure]);
  const calculation = useCalculation(request);
  const measurement = calculation.result;
  const analysis = useMemo(
    () => measurement && analysisOf(text, measurement, { limit, onlyOver, page }),
    [measurement, text, limit, onlyOver, page],
  );

  return {
    text, replaceInput, resetInput, inputRevision, fileLoader,
    newline, setNewline,
    measure, setMeasure: (value: Measure) => { saveMeasure(value); setPage(0); },
    limitText, setLimitText: (value: string) => { saveLimitText(value); setPage(0); },
    limit, invalidLimit,
    onlyOver, setOnlyOver: (value: boolean) => { saveOnlyOver(value); setPage(0); },
    view, setView,
    page, setPage,
    calculation, analysis,
  };
}
