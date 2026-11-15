/** Trusted Types を通して、ビルドに含めた Worker のコードを blob: の URL から起動する。 */
import { TRUSTED_TYPES_POLICIES } from '../../../csp.config';

type ScriptUrlPolicy = { createScriptURL: (url: string) => unknown };
type TrustedTypes = {
  createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => ScriptUrlPolicy;
};

/** Trusted Types は同じ名前のポリシーを2回作れないため、名前ごとに1つだけ作って使い回す */
const policies = new Map<string, ScriptUrlPolicy>();
/** ポリシーの名前ごとの blob: の URL。Worker を起動するたびに作らず、使い回す（解放しないため数を増やさない） */
const workerUrls = new Map<string, string>();

function policyFor(policyName: string): ScriptUrlPolicy | undefined {
  const types = (window as Window & { trustedTypes?: TrustedTypes }).trustedTypes;
  let policy = policies.get(policyName);
  if (types && !policy) {
    policy = types.createPolicy(policyName, {
      createScriptURL: (value) => {
        if (value !== workerUrls.get(policyName)) throw new TypeError('ビルドに含まれる Worker 以外の URL は許可されていません');
        return value;
      },
    });
    policies.set(policyName, policy);
  }
  return policy;
}

/**
 * Worker 用の Trusted Types のポリシーを、ほかのコードより先にすべて作る（src/trustedTypes.ts から起動時に呼ぶ）。
 * 使うときに作ると、まだ作っていない名前を別のコードに先に使われ、任意の URL を通すポリシーを作られるため
 */
export function createWorkerPolicies(): void {
  for (const name of Object.values(TRUSTED_TYPES_POLICIES)) policyFor(name);
}

/**
 * ビルドに含まれる Worker のコード（vite.config.ts の ?worker-source）を、blob: の URL から起動する。
 * URL から読み込んだ Worker にはページの <meta> の CSP が適用されないが、blob: の Worker は引き継ぐため、
 * Worker の中でも connect-src 'none' などが効く。
 * Trusted Types のポリシーは、そのポリシーで作った blob: の URL だけを完全一致で許可する。
 * 任意の URL やスクリプトの本文は受け取らない。policyName は csp.config.ts の TRUSTED_TYPES_POLICIES の値
 */
export function createTrustedWorker(policyName: string, source: string): Worker {
  let url = workerUrls.get(policyName);
  if (!url) {
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    workerUrls.set(policyName, url);
  }
  const policy = policyFor(policyName);
  /** DOM の型定義に TrustedScriptURL がない環境でも、実行時は信頼済みの値をそのまま渡す。 */
  return new Worker((policy ? policy.createScriptURL(url) : url) as string, { type: 'module' });
}
