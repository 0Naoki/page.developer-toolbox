/**
 * 回帰テストとして残す検証（docs/TESTING.md の「既知不具合を守るテスト」で、このファイルが担当）。
 * テストを移動・統合するときは、ここに挙げた入力とアサーションを削らずに引き継ぐ。
 *
 * - import × 文字列・式のないテンプレート・実行時の式：静的なパスを抽出し、本文の例や未確定のパスを誤検出しない
 */
import { describe, expect, it } from 'vitest';
import { codeOf, localImports, networkReferences } from './sourceScan.testing';

/**
 * 静的検査（src/architecture.test.ts）が使う、ソースの解析（src/sourceScan.testing.ts）そのもののテスト。
 * 規則の例と、アプリのソースが規則を守っていることは architecture.test.ts で確かめる。
 */

describe('ローカル依存の抽出', () => {
  it('式を含まないテンプレートの動的 import を抽出する', () => {
    const source = 'const lazy = import(`../csv-json/logic`);';
    expect(localImports('/src/fixtures/template/index.tsx', source)).toEqual(['/src/fixtures/csv-json/logic']);
  });

  it('文字列とテンプレートのエスケープを解釈したパスを抽出する', () => {
    const source = 'const a = import("./ty\\u0070es"); const b = import(`./ty\\u0070es`);';
    expect(localImports('/src/fixtures/escaped.ts', source)).toEqual(['/src/fixtures/types', '/src/fixtures/types']);
  });

  it('?worker-source などの問い合わせを付けた import は、問い合わせを除いたパスにする（Worker のコードの依存も import の向きの規則で確かめるため）', () => {
    const source = "import source from '../../calculation/worker?worker-source';";
    expect(localImports('/src/lib/worker/example.ts', source)).toEqual(['/src/calculation/worker']);
  });

  it('実行時の式を含むパスや、import でない文字列から依存を推測しない', () => {
    const source = 'const text = `import("./fake")`; const lazy = import(`./${name}`); const variable = import(name); const joined = import("./" + "joined");';
    expect(localImports('/src/fixtures/computed.ts', source)).toEqual([]);
  });
  it('import に似た文字列・テンプレート・JSX の本文を依存に数えない', () => {
    const source = `const example = "import '../csv-json/logic'";
      const template = \`from '../csv-json/logic'\`;
      const view = <p>from '../csv-json/logic'</p>;`;
    expect(localImports('/src/fixtures/example.tsx', source)).toEqual([]);
  });

  it('静的・型・副作用の import、再エクスポート、動的 import を抽出する', () => {
    const source = `import type { A } from './types';
      import './setup';
      export { value } from './values';
      export * from './all';
      const lazy = import('./lazy');
      type B = import('./other-types').B;`;
    expect(localImports('/src/example.ts', source)).toEqual([
      '/src/types', '/src/setup', '/src/values', '/src/all', '/src/lazy', '/src/other-types',
    ]);
  });
});

describe('コメントの除去と通信の API の参照', () => {
  it('文字列や正規表現の中の「/*」「//」をコメントと誤って、後ろのコードを消さない', () => {
    /** 規則の例ではなく、コメントの除き方そのものを確かめる */
    const hits = (code: string) => (/\bfetch\s*\(/.test(codeOf(code)) ? 1 : 0);
    for (const code of [
      "const begin = '/*'; fetch('/leak'); const end = '*/';",
      "const u = 'a//b'; fetch('/x')",
      'const s = `x // y`; fetch(\'/x\')',
      "const re = /\\/\\//; fetch('/x')",
      "const label = <a title=\"//\">x</a>; fetch('/x')",
      "/** 日本語の説明 */ const t = 'あ//い'; fetch('/x') // 末尾の説明",
    ]) expect(hits(code), code).toBe(1);
  });

  it('通信の API は、呼び出し以外の形で参照しても見つける', () => {
    for (const code of [
      'const send = fetch; send(url);',
      "window['fetch'](url);",
      'globalThis.XMLHttpRequest',
      'const { sendBeacon } = navigator;',
      'navigator.sendBeacon(url, data);',
      'new self.WebSocket(url);',
      "const W = window['EventSource'];",
      "const { fetch: send } = window; send('/leak');",
      "const { 'fetch': send } = window;",
      "const { ['XMLHttpRequest']: X } = globalThis;",
      'function f({ sendBeacon: beacon } = navigator) { return beacon; }',
    ]) expect(networkReferences(code), code).toHaveLength(1);
    /** オブジェクトや型のキー、JSX の属性名、文字列・コメントの中は、API の参照ではない */
    for (const code of [
      'const o = { fetch: 1 };',
      'type T = { fetch: string };',
      "const label = <a title='fetch'>fetch</a>;",
      "const s = 'fetch(url)'; // fetch(url)",
    ]) expect(networkReferences(code), code).toEqual([]);
  });

  it('解析できないソースは、検査を素通りさせずに失敗させる', () => {
    expect(() => codeOf("const a = '閉じていない文字列;\nfetch('/x')")).toThrow('解析できません');
  });
});
