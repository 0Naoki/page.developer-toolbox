import { DOCUMENT_LIMITS } from './documentLimitsCatalog.testing';
import { describe, expect, it } from 'vitest';

import { CLOUD_POLICIES, CLOUD_POLICY_CHECKED_AT } from './tools/subnet/cloudPolicy';

import { markdown } from './documentSources.testing';
import { containsLimit, limitTokens, markedSection, documentLimitIssues } from './documentMarkdown.testing';

describe('ドキュメントの制約と定数', () => {
  it('段落・箇条書き・言い回しを変えても数値と対象を照合できる', () => {
    expect(limitTokens('子は1,000件ずつ表示')).toEqual(limitTokens('ページサイズ：1,000件'));
    /** 単位を消した説明（「先頭100」）を、「先頭100種類」と同じとみなさない */
    expect(limitTokens('先頭100種類')).not.toEqual(limitTokens('先頭100'));
    expect(markedSection('<!-- tools:start -->\n- JWT\n- Hash\n<!-- tools:end -->', 'tools')).toContain('- Hash');
    expect(() => markedSection('<!-- tools:start -->', 'tools')).toThrow();
  });
  it('クラウドの案内の参照元と確認日が利用ガイドに載っている', () => {
    const usage = markdown['/docs/USAGE.md'] ?? '';
    expect(usage).toContain(CLOUD_POLICY_CHECKED_AT);
    for (const policy of CLOUD_POLICIES) expect(usage).toContain(policy.source);
  });

  it('上限を別の数値の一部分として見つけない', () => {
    expect(containsLimit('1800万単位', '800万単位')).toBe(false);
    expect(containsLimit('プレビュー先頭150,000単位', '50,000単位')).toBe(false);
    expect(containsLimit('シフト量は0〜4,0960', 'シフト量は0〜4,096')).toBe(false);
    expect(containsLimit('入力800万単位、出力は50,000単位', '800万単位')).toBe(true);
  });

  it('USAGE の各上限IDが、正しいツール・列・値・単位と対応する', () => {
    expect(documentLimitIssues(markdown['/docs/USAGE.md'] ?? '', DOCUMENT_LIMITS)).toEqual([]);
  });

  it('分割の表示上限と全件出力上限を入れ替えると失敗する', () => {
    const source = markdown['/docs/USAGE.md'] ?? '';
    expect(documentLimitIssues(source, DOCUMENT_LIMITS)).toEqual([]);
    expect(documentLimitIssues(source.replace('分割の一覧は', '一覧の表示上限：'), DOCUMENT_LIMITS)).toEqual([]);
    expect(documentLimitIssues(source.replace('16進ダンプ', 'hexダンプ').replace('UTF-8ファイル', 'UTF8のファイル'), DOCUMENT_LIMITS)).toEqual([]);
    const changed = source.replace('分割の一覧は1,024件', '分割の一覧は100,000件').replace('均等分割の全件出力は100,000件', '均等分割の全件出力は1,024件');
    expect(changed).not.toBe(source);
    expect(documentLimitIssues(changed, DOCUMENT_LIMITS)).toEqual(expect.arrayContaining([
      expect.stringContaining('subnet.split-preview'), expect.stringContaining('subnet.split-output'),
    ]));
  });
});
