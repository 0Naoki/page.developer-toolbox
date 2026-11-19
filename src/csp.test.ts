/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、e2e/browser-security.spec.ts と分担）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - CSP・埋め込み：CSP の指定の一覧を完全一致で確かめる（部分一致では、許可を足して緩めても検査が通るため）
 */
import { describe, expect, it } from 'vitest';
import { CSP, CSP_DIRECTIVES, TRUSTED_TYPES_POLICIES } from '../csp.config';

describe('CSP', () => {
  it('指定の一覧が、期待した値と完全に一致する（許可を足すと失敗する）', () => {
    /**
     * この期待値を変えるときは、csp.config.ts に理由を書く（AGENTS.md の「CSP を緩める変更」）。
     * 指定を足す・値を足すだけでなく、指定を消して default-src に任せる変更も、ここで止まる
     */
    expect(CSP_DIRECTIVES).toStrictEqual({
      'default-src': "'none'",
      'script-src': "'self'",
      'style-src': "'self'",
      'img-src': "'self'",
      'font-src': "'self'",
      'connect-src': "'none'",
      'worker-src': 'blob:',
      'base-uri': "'none'",
      'form-action': "'none'",
      'object-src': "'none'",
      'require-trusted-types-for': "'script'",
      'trusted-types': 'dev-toolbox-regex-worker dev-toolbox-calculation-worker',
    });
    expect(Object.values(TRUSTED_TYPES_POLICIES)).toEqual(['dev-toolbox-regex-worker', 'dev-toolbox-calculation-worker']);
  });

  it('埋め込む文字列は、指定の一覧をそのまま「; 」でつないだもの（文字列の側で指定を足していない）', () => {
    expect(CSP).toBe(Object.entries(CSP_DIRECTIVES).map(([name, value]) => `${name} ${value}`).join('; '));
  });
});
