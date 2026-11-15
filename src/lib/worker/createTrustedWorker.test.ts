import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSP_DIRECTIVES, TRUSTED_TYPES_POLICIES } from '../../../csp.config';

vi.mock('../../tools/regex/worker?worker-source', () => ({ default: 'self.onmessage = () => {}; // regex' }));
vi.mock('../../calculation/worker?worker-source', () => ({ default: 'self.onmessage = () => {}; // calculation' }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

type Rules = { createScriptURL: (url: string) => string };

/** blob: の URL を作る処理を用意する。作った URL と、その中身を記録する */
function stubBlobUrls() {
  const sources: string[] = [];
  const createObjectURL = vi.fn((blob: { parts: string[] }) => {
    sources.push(blob.parts.join(''));
    return `blob:https://example.test/${sources.length}`;
  });
  vi.stubGlobal('Blob', function (this: { parts: string[] }, parts: string[]) { this.parts = parts; });
  /** URL そのものは Vitest も使うため差し替えず、createObjectURL だけを置き換える */
  vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL as unknown as typeof URL.createObjectURL);
  return { sources, createObjectURL };
}

/** Trusted Types に対応したブラウザを用意する。作られたポリシーの名前と規則を記録する */
function stubTrustedTypes() {
  const created: { name: string; rules: Rules }[] = [];
  const trusted = { toString: () => '信頼済みのURL' };
  const createPolicy = vi.fn((name: string, rules: Rules) => {
    created.push({ name, rules });
    return { createScriptURL: (value: string) => (rules.createScriptURL(value), trusted) };
  });
  const worker = vi.fn(function () {});
  vi.stubGlobal('Worker', worker);
  vi.stubGlobal('window', { trustedTypes: { createPolicy } });
  return { created, createPolicy, worker, trusted, ...stubBlobUrls() };
}

describe('createTrustedWorker', () => {
  it('Trusted Types 未対応でも、Worker のコードから作った blob: の URL で起動する', async () => {
    const { sources } = stubBlobUrls();
    const worker = vi.fn(function () {});
    vi.stubGlobal('Worker', worker);
    vi.stubGlobal('window', {});
    const { createTrustedWorker } = await import('./createTrustedWorker');
    createTrustedWorker('p', 'self.onmessage = null;');
    expect(sources).toEqual(['self.onmessage = null;']);
    expect(worker).toHaveBeenCalledWith('blob:https://example.test/1', { type: 'module' });
  });

  it('作った blob: の URL だけを信頼し、ほかの URL や HTML・スクリプト本文のポリシーは作らない', async () => {
    const { created, worker, trusted } = stubTrustedTypes();
    const { createTrustedWorker } = await import('./createTrustedWorker');
    createTrustedWorker('p', 'self.onmessage = null;');
    const { rules } = created[0]!;
    expect(Object.keys(rules)).toEqual(['createScriptURL']);
    expect(rules.createScriptURL('blob:https://example.test/1')).toBe('blob:https://example.test/1');
    expect(() => rules.createScriptURL('blob:https://example.test/2')).toThrow();
    expect(() => rules.createScriptURL('https://example.test/dev-toolbox/assets/regex-worker.js')).toThrow();
    expect(() => rules.createScriptURL('https://outside.test/worker.js')).toThrow();
    expect(() => rules.createScriptURL('data:text/javascript,alert(1)')).toThrow();
    expect(worker).toHaveBeenCalledWith(trusted, { type: 'module' });
  });

  it('ポリシーと blob: の URL は名前ごとに1回だけ作る（同じ名前のポリシーを2回作るとブラウザが拒否するため）', async () => {
    const { createPolicy, createObjectURL, worker } = stubTrustedTypes();
    const { createTrustedWorker } = await import('./createTrustedWorker');
    createTrustedWorker('a', 'a');
    createTrustedWorker('a', 'a');
    createTrustedWorker('b', 'b');
    expect(createPolicy.mock.calls.map(([name]) => name)).toEqual(['a', 'b']);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(worker).toHaveBeenCalledTimes(3);
  });

  it('起動時に CSP の trusted-types に書いた名前のポリシーをすべて作り、まだ何も許可しない', async () => {
    const { created } = stubTrustedTypes();
    const { createWorkerPolicies } = await import('./createTrustedWorker');
    createWorkerPolicies();
    expect(created.map((p) => p.name)).toEqual(Object.values(TRUSTED_TYPES_POLICIES));
    /** Worker を起動する前は blob: の URL もないため、どんな URL も通さない */
    for (const { rules } of created) expect(() => rules.createScriptURL('blob:https://example.test/1')).toThrow();
  });
});

describe('正規表現・計算の Worker', () => {
  it('CSP の trusted-types に書いた名前のポリシーで、それぞれのコードを blob: の URL から起動する', async () => {
    const { created, worker, sources } = stubTrustedTypes();
    const { createWorkerPolicies } = await import('./createTrustedWorker');
    createWorkerPolicies();
    const { createRegexWorker } = await import('../../tools/regex/createWorker');
    const { createCalculationWorker } = await import('../../calculation/createWorker');
    createRegexWorker();
    createCalculationWorker();
    expect(created.map((p) => p.name)).toEqual([TRUSTED_TYPES_POLICIES.regexWorker, TRUSTED_TYPES_POLICIES.calculationWorker]);
    expect(CSP_DIRECTIVES['trusted-types']?.split(' ')).toEqual(Object.values(TRUSTED_TYPES_POLICIES));
    expect(sources).toEqual(['self.onmessage = () => {}; // regex', 'self.onmessage = () => {}; // calculation']);
    expect(worker).toHaveBeenCalledTimes(2);
    /** それぞれのポリシーは、自分の Worker の URL だけを許可する */
    expect(() => created[0]!.rules.createScriptURL('blob:https://example.test/2')).toThrow();
    expect(() => created[1]!.rules.createScriptURL('blob:https://example.test/1')).toThrow();
  });

  it('Worker は blob: の URL からだけ起動でき、同じオリジンのファイルは起動できない', () => {
    expect(CSP_DIRECTIVES['worker-src']).toBe('blob:');
  });
});
