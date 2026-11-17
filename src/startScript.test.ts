/**
 * 起動スクリプト（start.ps1）と、依存の準備の手順の検査。
 *
 * @remarks
 * start.ps1 は Windows でしか動かず、CI では実行しない。版の条件や準備のコマンドを別々に書くと食い違うため、
 * package.json・.nvmrc・CI・文書と同じものを使っていることを、実行せずに確かめる。
 */
import { describe, expect, it } from 'vitest';
import script from '../start.ps1?raw';

const raw = (glob: Record<string, string>) => Object.values(glob)[0] ?? '';
const pkg = JSON.parse(raw(import.meta.glob<string>('/package.json', { query: '?raw', import: 'default', eager: true }))) as {
  engines?: { node?: string };
  scripts?: Record<string, string>;
};
const nvmrc = raw(import.meta.glob<string>('/.nvmrc', { query: '?raw', import: 'default', eager: true })).trim();
const checksWorkflow = raw(import.meta.glob<string>('/.github/workflows/checks.yml', { query: '?raw', import: 'default', eager: true }));
const setupDocs = import.meta.glob<string>(['/README.md', '/docs/LOCAL_CHECK.md', '/docs/TESTING.md'], { query: '?raw', import: 'default', eager: true });

it('start.ps1 は BOM 付きで保存する（Windows PowerShell 5.1 が日本語を読めるように）', () => {
  expect(script.startsWith('﻿')).toBe(true);
});

describe('Node.js の版', () => {
  /** vitest（devDependencies）が対応する版と同じにする。23・25 などの奇数の版は対応しない */
  const ENGINES = '^22.12.0 || ^24.0.0 || >=26.0.0';

  it('package.json の engines・.nvmrc・start.ps1 の判定が同じ条件を指す', () => {
    expect(pkg.engines?.node).toBe(ENGINES);
    expect(nvmrc).toBe('24');
    /** start.ps1 は engines と同じ条件を、コメントと判定の両方に書く */
    expect(script).toContain(ENGINES);
    expect(script).toContain("$version.Major -eq 22 -and $version -ge [version]'22.12.0'");
    expect(script).toContain('$version.Major -eq 24');
    expect(script).toContain('$version.Major -ge 26');
  });
});

describe('依存の準備', () => {
  it('package.json の setup は、インストールスクリプトを実行せずに取得し、署名を検証する', () => {
    expect(pkg.scripts?.setup).toBe('npm ci --ignore-scripts && npm run audit:signatures');
  });

  it('CI・start.ps1・文書は、同じ setup を使う（npm ci を直接書かない）', () => {
    expect(checksWorkflow).toMatch(/^\s+- run: npm run setup$/m);
    expect(checksWorkflow).not.toMatch(/^\s+- run: npm ci/m);
    expect(script).toContain("@('run', 'setup')");
    expect(script).not.toContain("@('ci'");
    for (const [file, text] of Object.entries(setupDocs)) {
      expect(text, file).toContain('npm run setup');
      /** コマンドの欄に、素の npm ci を書かない（CI と違う手順になるため） */
      expect(text, file).not.toMatch(/^npm ci\b/m);
    }
  });

  it('回帰：start.ps1 は、署名の検証が通った印と package-lock.json のハッシュで準備済みかを判断する', () => {
    /**
     * vite.cmd・tsc.cmd があるかだけで判断していたため、取得や検証の途中で止めると、検証していない依存を次の起動で使っていた。
     * package-lock.json が変わっても準備し直さなかった
     */
    expect(script).not.toContain('vite.cmd');
    expect(script).toContain("Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256");
    /** 印は、setup が成功した後にだけ書く */
    const setupAt = script.indexOf("@('run', 'setup')");
    const markAt = script.indexOf('Set-Content -LiteralPath $verifiedMarker');
    expect(setupAt).toBeGreaterThan(0);
    expect(markAt).toBeGreaterThan(setupAt);
    /** 取得・検証に失敗したら、途中の依存を消す */
    expect(script.slice(setupAt, markAt)).toContain("Remove-Item -LiteralPath 'node_modules'");
  });
});
