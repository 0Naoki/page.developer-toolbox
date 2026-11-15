import { createWorkerPolicies } from './lib/worker/createTrustedWorker';

/** src/main.tsx の最初に読み込み、依存ライブラリなどほかのコードより先に Worker 用のポリシーを作る */
createWorkerPolicies();
