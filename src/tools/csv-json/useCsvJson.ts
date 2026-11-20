import { useLayoutEffect, useMemo, useState } from 'react';
import { useInput } from '../../hooks/useInput';
import { useFileLoader } from '../../hooks/useFileLoader';
import { usePreference } from '../../hooks/usePreference';
import { useCalculation } from '../../hooks/useCalculation';
import { INPUT_TOO_LARGE, MAX_CALCULATION_FILE_BYTES, MAX_CALCULATION_INPUT } from '../../lib/worker/calculationLimits';
import { isBoolean, oneOf } from '../../lib/settings';
import { decodeText, FileInputError, type TextEncodingName } from '../../lib/file';
import { DEFAULT_CSV_TO_JSON, isCsvToJsonOptions, isEmptyConversionInput, type CsvToJsonOptions } from './logic';
import { DEFAULT_JSON_TO_CSV, isJsonToCsvOptions, type JsonToCsvOptions } from './writeCsv';
import { optionsForFile, optionsForSwap, type Direction } from './fileOptions';

/**
 * CSV ⇔ JSON の画面の状態（入力・変換の向きと設定・ファイルの読み込み）と、計算の結果。
 *
 * @remarks
 * 入力を置き換えるとき（クリア・サンプル・入れ替え・ファイルの読み込み）は、入力欄の編集履歴を作り直し、前の入力に戻れないようにする。
 * 入力欄の編集では、読み込み中のファイルの結果を破棄する。
 * 変換の向き・設定・文字コードを変えたときは、古い設定で始めた読み込みの結果（とファイル名から選んだ設定）を反映しない。
 * 入力は sessionStorage に保存し（useInput）、設定は localStorage に保存する（usePreference）。
 */
export function useCsvJson() {
  const [direction, setDirection] = usePreference<Direction>('csv:dir', 'csv2json', oneOf('csv2json', 'json2csv'));
  const [input, setInput] = useInput('csv');
  const [csvOptions, setCsvOptions] = usePreference<CsvToJsonOptions>('csv:c2j', DEFAULT_CSV_TO_JSON, isCsvToJsonOptions);
  const [jsonOptions, setJsonOptions] = usePreference<JsonToCsvOptions>('csv:j2c', DEFAULT_JSON_TO_CSV, isJsonToCsvOptions);
  const [encoding, setEncoding] = usePreference<TextEncodingName>('csv:encoding', 'utf-8', oneOf('utf-8', 'shift_jis'));
  const [bom, setBom] = usePreference('csv:bom', true, isBoolean);
  /** 入力欄の編集履歴を作り直す番号 */
  const [inputRevision, setInputRevision] = useState(0);

  const fileLoader = useFileLoader({
    limit: MAX_CALCULATION_FILE_BYTES,
    tooLargeHint: '。分割して読み込んでください。',
    decode: (bytes) => {
      const text = decodeText(bytes, encoding);
      if (text.length > MAX_CALCULATION_INPUT) throw new FileInputError(INPUT_TOO_LARGE);
      return text;
    },
    /** 読めなかったときは共通の文言、読めた後に文字コードとして不正だったときは文字コードの確認を案内する */
    decodeErrorMessage: () => 'ファイルを読み込めません。選んだ文字コードと、ファイルの文字コードが合っているか確認してください。',
    onLoaded: (text, file) => {
      setInput(text);
      setInputRevision((revision) => revision + 1);
      const next = optionsForFile(file.name, { direction, delimiter: csvOptions.delimiter });
      if (next.direction !== direction) setDirection(next.direction);
      if (next.delimiter !== csvOptions.delimiter) setCsvOptions({ ...csvOptions, delimiter: next.delimiter });
    },
  });

  /** 入力欄での編集。読み込み中のファイルの結果は破棄する */
  const replaceInput = (value: string) => {
    fileLoader.clear();
    setInput(value);
  };
  /** クリア・サンプル・入れ替えで入力を置き換える。編集履歴も作り直す */
  const resetInput = (value: string) => {
    replaceInput(value);
    setInputRevision((revision) => revision + 1);
  };
  /** 設定変更後に、古い設定で始めた読込結果やファイル名由来の設定を反映しない。 */
  const cancelRead = fileLoader.cancel;
  useLayoutEffect(() => { cancelRead(); }, [cancelRead, direction, csvOptions, jsonOptions, encoding]);

  const request = useMemo(() => ({ tool: 'csv' as const, input, direction, csvOptions, jsonOptions }), [input, direction, csvOptions, jsonOptions]);
  const calculation = useCalculation(request);
  const result = isEmptyConversionInput(input, direction) ? null : calculation.result;
  /** 変換結果が逆方向の入力上限を超えるときは、入れ替えられない */
  const swapTooLarge = result !== null && result.output.length > MAX_CALCULATION_INPUT;

  /** 出力を入力に移し、変換の向きを反転する。元の向きの区切り文字を、移る先の向きの設定に引き継ぐ */
  const swap = () => {
    if (!result || swapTooLarge) return;
    resetInput(result.output);
    const next = optionsForSwap(direction, { csv2json: csvOptions.delimiter, json2csv: jsonOptions.delimiter });
    setDirection(next.direction);
    if (next.direction === 'csv2json' && next.delimiter !== csvOptions.delimiter) setCsvOptions({ ...csvOptions, delimiter: next.delimiter });
    if (next.direction === 'json2csv' && next.delimiter !== jsonOptions.delimiter) setJsonOptions({ ...jsonOptions, delimiter: next.delimiter });
  };

  return {
    direction, setDirection,
    input, replaceInput, resetInput, inputRevision, fileLoader,
    csvOptions, setCsvOptions, jsonOptions, setJsonOptions,
    encoding, setEncoding, bom, setBom,
    calculation, result, swapTooLarge, swap,
  };
}
