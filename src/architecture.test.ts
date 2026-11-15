import { describe, expect, it } from 'vitest';
import { codeOf, localImports, networkReferences } from './sourceScan.testing';
import { IMPORT_RULES, SOURCE_RULES, type SourceRule } from './sourceRules.testing';

/**
 * アプリのソース（テストと、テストからだけ読む *.testing.ts（補助の処理）・*.fixtures.ts（テスト用のデータ）を除く）。キーは「/src/tools/json-formatter/logic.ts」の形。
 *
 * @remarks
 * 本番の E2E は実行した画面と分岐しか確かめられないため、禁止している API や依存の方向をソースで確かめる。
 * 解析は src/sourceScan.testing.ts、規則（書き方・import の向き）と検出例は src/sourceRules.testing.ts にある。
 */
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts', '!/src/**/*.testing.ts', '!/src/**/*.fixtures.ts', '!/src/**/*.d.ts'], { query: '?raw', import: 'default', eager: true });

/** 構文木から通信の API の参照を探す検査（sourceScan.testing.ts の networkReferences）の直し方 */
const NETWORK_FIX = '外部と通信しない書き方に直す（fetch・XMLHttpRequest・WebSocket・EventSource・sendBeacon・WebTransport を、変数に入れる・window["fetch"] などの形でも参照しない）';

/** 規則の pattern から、すべての箇所を探すための正規表現を作る */
const globalOf = (pattern: RegExp) => new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');

/** 規則に反する箇所。label のない規則はファイル単位、ある規則は「ファイル 名前」の箇所単位 */
function violations(rule: SourceRule, code: string, file: string): string[] {
  if (!rule.label) return rule.pattern.test(code) ? [file] : [];
  return [...code.matchAll(globalOf(rule.pattern))].flatMap(([match]) => {
    const name = rule.label!(match);
    return name === null ? [] : [`${file} ${name}`];
  });
}

describe('ソースの静的検査', () => {
  it('検査の対象のソースを集められている', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('どの規則にも直し方がある（失敗したときに表示する）', () => {
    expect([...SOURCE_RULES, ...IMPORT_RULES].filter((rule) => rule.fix.trim() === '').map((rule) => rule.name)).toEqual([]);
  });

  it('外部と通信する API を、どの形でも参照していない', () => {
    const found = Object.entries(sources).flatMap(([file, source]) => networkReferences(source, file));
    expect(found, `直し方：${NETWORK_FIX}`).toEqual([]);
  });

  describe.each(SOURCE_RULES)('$name', (rule) => {
    const { appliesTo, allowed = {}, detects, ignores, fix } = rule;
    it('アプリのソースが規則を守っている', () => {
      const matched = Object.entries(sources)
        .filter(([file]) => !appliesTo || appliesTo(file))
        .flatMap(([file, source]) => violations(rule, codeOf(source, file), file));
      expect(matched.filter((key) => !(key in allowed)), `直し方：${fix}`).toEqual([]);
      /** 使わなくなった例外は、一覧からも消す（不要な許可を残さない） */
      expect(Object.keys(allowed).filter((key) => !matched.includes(key))).toEqual([]);
    });

    it('検出すべき書き方を見つけ、正しい書き方は見逃す', () => {
      expect(detects.length).toBeGreaterThan(0);
      expect(ignores.length).toBeGreaterThan(0);
      for (const code of detects) expect(violations(rule, codeOf(code), 'example'), code).not.toEqual([]);
      for (const code of ignores) expect(violations(rule, codeOf(code), 'example'), code).toEqual([]);
    });
  });

  describe.each(IMPORT_RULES)('$name', ({ forbids, allowed = {}, detects, ignores, fix }) => {
    it('アプリのソースが規則を守っている', () => {
      const found = Object.entries(sources).flatMap(([file, source]) =>
        localImports(file, source).filter((target) => forbids({ file, target })).map((target) => `${file} → ${target}`));
      expect(found.filter((edge) => !(edge in allowed)), `直し方：${fix}`).toEqual([]);
      /** 依存をなくしたら、許可の一覧からも消す（不要な許可を残さない） */
      expect(Object.keys(allowed).filter((edge) => !found.includes(edge))).toEqual([]);
    });

    it('検出すべき組を見つけ、許した組は見逃す', () => {
      expect(detects.length).toBeGreaterThan(0);
      expect(ignores.length).toBeGreaterThan(0);
      for (const edge of detects) expect(forbids(edge), JSON.stringify(edge)).toBe(true);
      for (const edge of ignores) expect(forbids(edge), JSON.stringify(edge)).toBe(false);
    });
  });
});
