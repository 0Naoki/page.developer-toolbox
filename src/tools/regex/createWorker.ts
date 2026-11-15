import { TRUSTED_TYPES_POLICIES } from '../../../csp.config';
import { createTrustedWorker } from '../../lib/worker/createTrustedWorker';
import workerSource from './worker?worker-source';

/** 正規表現の計算用の Worker を起動する（時間のかかる式を中断できるように） */
export const createRegexWorker = (): Worker => createTrustedWorker(TRUSTED_TYPES_POLICIES.regexWorker, workerSource);
