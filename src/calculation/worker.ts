/** 大容量計算の Worker の入口（createWorker.ts が ?worker-source で1つにまとめて起動する） */
import { calculate } from './handlers';
import type { CalculationRequest, CalculationResponse } from './protocol';
import { errorMessage } from '../lib/errors';

self.onmessage = (event: MessageEvent<CalculationRequest>) => {
  let response: CalculationResponse;
  try {
    response = { ok: true, tool: event.data.tool, result: calculate(event.data) } as CalculationResponse;
  } catch (error) {
    response = { ok: false, error: errorMessage(error, '計算できませんでした。入力を確認してください。') };
  }
  self.postMessage(response);
};
