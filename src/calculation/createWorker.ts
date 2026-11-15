/** 大容量計算の Worker（worker.ts）を起動する。 */
import { TRUSTED_TYPES_POLICIES } from '../../csp.config';
import { createTrustedWorker } from '../lib/worker/createTrustedWorker';
import workerSource from './worker?worker-source';

/** 整形・変換・文字数の計算用の Worker を起動する（計算を中断できるように） */
export const createCalculationWorker = (): Worker => createTrustedWorker(TRUSTED_TYPES_POLICIES.calculationWorker, workerSource);
