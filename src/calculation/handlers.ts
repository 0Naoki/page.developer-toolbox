/**
 * 計算 Worker（src/calculation/worker.ts）で行う、ツールごとの計算の振り分け。
 *
 * @remarks
 * ツールの計算処理を呼ぶだけにし、結果の形を整える処理（警告の件数・要約の文言など）はツールの側に置く。
 * 要求の型と結果の型の組は src/calculation/protocol.ts にある。
 */
import { formatJsonForScreen } from '../tools/json-formatter/logic';
import { measureText } from '../tools/text-count/logic';
import { convertCsvRequest } from '../tools/csv-json/calculation';
import { calculateDiff } from '../tools/text-diff/calculation';
import { convertEpochsInText } from '../tools/unix-time/epoch';
import { aggregateList, calculateSplit, calculateVlsm, checkOverlapList } from '../tools/subnet/listCalculation';
import { convertText } from '../tools/base64/logic';
import { INPUT_TOO_LARGE, MAX_CALCULATION_INPUT } from '../lib/worker/calculationLimits';
import { calculationInputSize, type CalculationRequestOf, type CalculationResults, type CalculationTool } from './protocol';

/**
 * ツールごとの計算。ツールの要求を受け取り、そのツールの結果の型を返すことを型で確かめる
 * （別のツールの結果を返す実装の誤りを、コンパイル時に見つけるため）
 */
const HANDLERS: { [T in CalculationTool]: (request: CalculationRequestOf<T>) => CalculationResults[T] } = {
  json: (request) => formatJsonForScreen(request.input, request.indent, request.sortKeys),
  count: (request) => measureText(request.input, request),
  epoch: (request) => convertEpochsInText(request.input, request.zone, request.mode),
  base64: (request) => convertText(request),
  subnetAggregate: (request) => aggregateList(request.input),
  subnetOverlap: (request) => checkOverlapList(request.input),
  subnetSplit: (request) => calculateSplit(request.input, request.newPrefix),
  subnetVlsm: (request) => calculateVlsm(request.input, request.network, request.prefix, request.cloud),
  diff: (request) => calculateDiff(request),
  csv: (request) => convertCsvRequest(request),
};

/** 計算の種類（tool）が HANDLERS にないときのエラー */
export const UNKNOWN_CALCULATION = '計算の種類が正しくありません。画面を再読み込みしてください。';

/** Worker から呼ぶ純粋な計算。入力の値や数値表記は既存のロジックで保持する。 */
export function calculate<T extends CalculationTool>(request: CalculationRequestOf<T>): CalculationResults[T] {
  /**
   * tool は Worker が受け取ったメッセージの値なので、HANDLERS 自身が持つ名前かを先に確かめる。
   * 確かめないと、toString などの Object.prototype のメソッドを呼んだり、関数でない値を呼んで例外になったりする
   */
  if (!Object.hasOwn(HANDLERS, request.tool)) throw new Error(UNKNOWN_CALCULATION);
  if (calculationInputSize(request) > MAX_CALCULATION_INPUT) throw new Error(INPUT_TOO_LARGE);
  /** 要求と処理の組は HANDLERS の型で確かめてあるため、ここでは tool で選んで呼ぶだけ */
  return (HANDLERS[request.tool as T] as (request: CalculationRequestOf<T>) => CalculationResults[T])(request);
}
