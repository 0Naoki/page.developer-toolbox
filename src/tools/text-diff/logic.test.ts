/** 検査の対象：logic.ts・myers.ts・unified.ts（専用のテストファイルを置かないファイルも、ここでまとめて検査する） */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIFF_TIMEOUT_MS, crlfFlags, diffChars, diffText, diffLines } from './logic';
import { diffSequencesWithStatus, type DiffOp } from './myers';
import { foldRows, unifiedDisplayRows, visibleRows } from './rowReference.testing';
import type { UnifiedDisplayRow } from './rows';
import { LINE_BREAK_CASES } from '../../lib/text/lines.fixtures';
import { toUnified } from './unified';

const NO_OPTS = { ignoreWhitespace: false, ignoreCase: false };
const diffSequences = <T>(a: T[], b: T[]) => diffSequencesWithStatus(a, b).ops;

/** 編集手順を適用して b を復元できるか確認する */
function apply(a: string[], b: string[], ops: DiffOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      expect(a[op.a]).toBe(b[op.b]);
      out.push(a[op.a]!);
    } else if (op.type === 'insert') out.push(b[op.b]!);
  }
  return out;
}

describe('diffSequences', () => {
  it('最短の編集手順を求める', () => {
    const a = [...'ABCABBA'];
    const b = [...'CBABAC'];
    const ops = diffSequences(a, b);
    expect(apply(a, b, ops).join('')).toBe('CBABAC');
    /** Myers の論文の例：最短編集距離は 5 */
    expect(ops.filter((o) => o.type !== 'equal').length).toBe(5);
  });

  it('ランダムな入力でも常に復元できる', () => {
    for (let t = 0; t < 300; t++) {
      const gen = () => Array.from({ length: Math.floor(Math.random() * 12) }, () => 'abc'.charAt(Math.floor(Math.random() * 3)));
      const a = gen();
      const b = gen();
      const ops = diffSequences(a, b);
      expect(apply(a, b, ops).join('')).toBe(b.join(''));
      expect(ops.filter((o) => o.type !== 'insert').length).toBe(a.length);
    }
  });

  it('常に最短の編集手順になる（動的計画法の LCS と比較）', () => {
    const lcs = (a: string[], b: string[]) => {
      const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      return dp[a.length]![b.length]!;
    };
    for (let t = 0; t < 500; t++) {
      const gen = () => Array.from({ length: Math.floor(Math.random() * 25) }, () => 'abcd'.charAt(Math.floor(Math.random() * 4)));
      const a = gen();
      const b = gen();
      const edits = diffSequences(a, b).filter((o) => o.type !== 'equal').length;
      expect(edits).toBe(a.length + b.length - 2 * lcs(a, b));
    }
  });

  it('大きな入力でも正しく復元できる', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const b = a.map((l, i) => (i % 200 === 0 ? `${l} changed` : l)).filter((_, i) => i % 333 !== 0);
    b.splice(5000, 0, 'inserted 1', 'inserted 2');
    const ops = diffSequences(a, b);
    expect(apply(a, b, ops).join('\n')).toBe(b.join('\n'));
  });

  it('時間切れでも正しい（復元できる）結果を返す', () => {
    /** 片方にしかない要素は先に除くので、すべて共通で順番だけが違うものにする */
    const a = Array.from({ length: 6000 }, (_, i) => `k${i}`);
    const b = [...a].reverse();
    const r = diffSequencesWithStatus(a, b, { timeoutMs: 0 });
    expect(r.timedOut).toBe(true);
    expect(apply(a, b, r.ops).join()).toBe(b.join());
  });

  it('片方にしかない行が多くても、変わらない行を正しく対応づける', () => {
    const a = Array.from({ length: 30000 }, (_, i) => (i % 3 ? `same ${i}` : `a${i}`));
    const b = Array.from({ length: 30000 }, (_, i) => (i % 3 ? `same ${i}` : `b${i}`));
    const r = diffSequencesWithStatus(a, b, { timeoutMs: 1000 });
    expect(r.timedOut).toBe(false);
    expect(r.ops.filter((op) => op.type === 'equal')).toHaveLength(20000);
    expect(apply(a, b, r.ops).join()).toBe(b.join());
  });

  it('共通する行がまったくない場合', () => {
    const ops = diffSequences(['a', 'b'], ['c']);
    expect(ops).toEqual([
      { type: 'delete', a: 0 },
      { type: 'delete', a: 1 },
      { type: 'insert', b: 0 },
    ]);
  });

  it('片方が空', () => {
    expect(diffSequences([], ['a'])).toEqual([{ type: 'insert', b: 0 }]);
    expect(diffSequences(['a'], [])).toEqual([{ type: 'delete', a: 0 }]);
  });
});

describe('diffText', () => {
  it('変更行を左右に対応づける', () => {
    const r = diffText('a\nb\nc', 'a\nB\nc\nd', NO_OPTS);
    expect(r.added).toBe(2);
    expect(r.removed).toBe(1);
    expect(r.rows.map((x) => x.kind)).toEqual(['equal', 'change', 'equal', 'change']);
    expect(r.rows[1]).toEqual({
      kind: 'change',
      left: { no: 2, text: 'b' },
      right: { no: 2, text: 'B' },
    });
  });

  it('似ていない行同士は文字単位で強調しない', () => {
    const r = diffText('ORDER BY price;', 'AND stock > 0', NO_OPTS);
    const [row] = r.rows;
    expect(row?.kind === 'change' && row.left?.segments).toBe(undefined);
    const similar = diffText('ORDER BY price;', 'ORDER BY price DESC;', NO_OPTS);
    const [similarRow] = similar.rows;
    expect(similarRow?.kind === 'change' && similarRow.right?.segments?.length).toBe(3);
  });

  it('空白・大文字小文字を無視できる', () => {
    expect(diffText('a  b\nC', ' a b\nc', { ignoreWhitespace: true, ignoreCase: true }).identical).toBe(true);
    expect(diffText('a  b', 'a b', NO_OPTS).identical).toBe(false);
  });

  it('改行コードの違いは無視する', () => {
    expect(diffText('a\r\nb', 'a\nb', NO_OPTS).identical).toBe(true);
  });

  it('unified形式で出力する（見出しとハンク付き）', () => {
    expect(toUnified(diffText('a\nb\nc\n', 'a\nx\nc\n', NO_OPTS))).toBe('--- before\n+++ after\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n');
  });

  it('unified形式：変更から離れた行は省き、近い変更は1つのハンクにまとめる', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n') + '\n';
    const after = before.replace('l2\n', 'L2\n').replace('l5\n', 'L5\n').replace('l18\n', 'L18\n');
    expect(toUnified(diffText(before, after, NO_OPTS))).toBe(
      [
        '--- before',
        '+++ after',
        '@@ -1,8 +1,8 @@',
        ' l1',
        '-l2',
        '+L2',
        ' l3',
        ' l4',
        '-l5',
        '+L5',
        ' l6',
        ' l7',
        ' l8',
        '@@ -15,6 +15,6 @@',
        ' l15',
        ' l16',
        ' l17',
        '-l18',
        '+L18',
        ' l19',
        ' l20',
        '',
      ].join('\n'),
    );
  });

  it('unified形式：行の追加・削除だけのハンクと、空のテキストからの追加', () => {
    expect(toUnified(diffText('a\nb\n', 'a\nb\nc\n', NO_OPTS))).toBe('--- before\n+++ after\n@@ -1,2 +1,3 @@\n a\n b\n+c\n');
    expect(toUnified(diffText('', 'x\n', NO_OPTS))).toBe('--- before\n+++ after\n@@ -0,0 +1 @@\n+x\n');
    expect(toUnified(diffText('x\n', '', NO_OPTS))).toBe('--- before\n+++ after\n@@ -1 +0,0 @@\n-x\n');
  });

  it('unified形式：末尾に改行がない行には「\\ No newline at end of file」を付ける', () => {
    expect(toUnified(diffText('a\nb', 'a\nc', NO_OPTS))).toBe(
      '--- before\n+++ after\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n',
    );
    /** 末尾の改行の有無だけが違う */
    expect(toUnified(diffText('a', 'a\n', NO_OPTS))).toBe(
      '--- before\n+++ after\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n',
    );
    expect(toUnified(diffText('a\n', 'a\n', NO_OPTS))).toBe('');
  });

  describe('時間の上限（DIFF_TIMEOUT_MS）', () => {
    /**
     * 文字単位の比較に時間の上限がないと、400文字×1000行で2.5秒かかる。
     * 実際の経過時間で確かめると PC の負荷で結果が変わるため、時計（performance.now）を差し替えて、
     * 時間を使い切ったら文字単位の比較をしないことを確かめる
     */
    afterEach(() => vi.restoreAllMocks());

    /** すべての行が少しずつ違う（文字単位で強調される）テキスト */
    const before = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const after = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(40)}y`).join('\n');
    const changeRows = (r: ReturnType<typeof diffText>) => r.rows.filter((row) => row.kind === 'change');

    it('時間が足りていれば、変更行を文字単位で強調する', () => {
      vi.spyOn(performance, 'now').mockReturnValue(0);
      const r = diffText(before, after, NO_OPTS);
      expect(r.approximate).toBe(false);
      expect(changeRows(r)).toHaveLength(200);
      expect(changeRows(r).every((row) => row.left?.segments && row.right?.segments)).toBe(true);
    });

    it('行の比較で時間を使い切ったら、文字単位の比較をしない（行の差分は正しい）', () => {
      /**
       * 打ち切り時刻を決める最初の呼び出しのあとは、ずっと上限を過ぎた時刻を返す。
       * 行の比較は自分の打ち切り時刻（その時点から DIFF_TIMEOUT_MS）で動くため、最後まで比較する
       */
      let calls = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => (calls++ === 0 ? 0 : DIFF_TIMEOUT_MS + 1));
      const r = diffText(before, after, NO_OPTS);
      expect(r.approximate).toBe(false);
      expect(r.removed).toBe(200);
      expect(r.added).toBe(200);
      expect(changeRows(r).some((row) => row.left?.segments || row.right?.segments)).toBe(false);
    });
  });
});

describe('diffChars', () => {
  it('行内の変更箇所を求める', () => {
    expect(diffChars('売上金額', '売上総金額')).toEqual({
      left: [{ text: '売上金額', changed: false }],
      right: [
        { text: '売上', changed: false },
        { text: '総', changed: true },
        { text: '金額', changed: false },
      ],
    });
  });

  it('時間内に終わらなければ、行全体を変更扱いにする', () => {
    expect(diffChars('abcdef', 'fedcba', { timeoutMs: -1 })).toEqual({
      left: [{ text: 'abcdef', changed: true }],
      right: [{ text: 'fedcba', changed: true }],
    });
  });
});

describe('foldRows', () => {
  it('変更のない部分を折りたたむ', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const after = before.replace('line10', 'LINE10');
    const folded = foldRows(diffText(before, after, NO_OPTS).rows, 2);
    expect(folded.map((r) => (r.kind === 'fold' ? `fold${r.count}` : r.kind))).toEqual([
      'fold8',
      'equal',
      'equal',
      'change',
      'equal',
      'equal',
      'fold7',
    ]);
  });
});

describe('visibleRows', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
  const rows = diffText(before, before.replace('line10', 'LINE10'), NO_OPTS).rows;
  const shape = (list: ReturnType<typeof visibleRows>) => list.map((r) => (r.kind === 'fold' ? `fold${r.from}+${r.count}` : r.kind));

  it('変更だけを表示しないときは、すべての行をそのまま返す', () => {
    expect(visibleRows(rows, { onlyChanges: false, context: 3, expanded: [] })).toBe(rows);
  });

  it('利用者が開いた折りたたみだけを元の行に戻し、ほかは折りたたんだままにする', () => {
    const folded = visibleRows(rows, { onlyChanges: true, context: 2, expanded: [] });
    expect(shape(folded)).toEqual(['fold0+8', 'equal', 'equal', 'change', 'equal', 'equal', 'fold13+7']);
    const opened = visibleRows(rows, { onlyChanges: true, context: 2, expanded: [13] });
    expect(shape(opened)).toEqual(['fold0+8', 'equal', 'equal', 'change', ...Array<string>(9).fill('equal')]);
    /** 前の比較結果で開いた位置（今の折りたたみにない位置）は無視する */
    expect(shape(visibleRows(rows, { onlyChanges: true, context: 2, expanded: [5] }))).toEqual(shape(folded));
  });
});

describe('unifiedDisplayRows', () => {
  const label = (r: UnifiedDisplayRow) => (r.kind === 'fold' ? `fold${r.count}` : `${r.kind}:${r.line.text}:${r.aNo ?? ''}/${r.bNo ?? ''}`);

  it('連続する変更は、削除した行をすべて並べてから追加した行を並べ、左右の行番号を付ける', () => {
    const { rows } = diffText('a\nb\nc\nd', 'a\nB\nC\nd', NO_OPTS);
    expect(unifiedDisplayRows(rows).map(label)).toEqual(['equal:a:1/1', 'del:b:2/', 'del:c:3/', 'add:B:/2', 'add:C:/3', 'equal:d:4/4']);
  });

  it('削除だけ・追加だけの変更と、折りたたみの区切りでも順序を保つ', () => {
    const { rows } = diffText('x\nold\ny', 'x\ny\nnew', NO_OPTS);
    expect(unifiedDisplayRows(rows).map(label)).toEqual(['equal:x:1/1', 'del:old:2/', 'equal:y:3/2', 'add:new:/3']);
    const fold = { kind: 'fold' as const, count: 4, from: 0 };
    expect(unifiedDisplayRows([fold, ...rows.slice(1)]).map(label)).toEqual(['fold4', 'del:old:2/', 'equal:y:3/2', 'add:new:/3']);
    expect(unifiedDisplayRows([])).toEqual([]);
  });

  it('連続する大量の変更行を、引数の展開に使わずに並べる（数十万行で RangeError にならない）', () => {
    const count = 200_000;
    const { rows } = diffText(Array<string>(count).fill('a').join('\n'), '', NO_OPTS);
    const unified = unifiedDisplayRows(rows);
    expect(unified).toHaveLength(rows.length);
    expect(unified.filter((r) => r.kind === 'del')).toHaveLength(count);
  });
});

describe('unified 形式の改行', () => {
  const opts = { ignoreWhitespace: false, ignoreCase: false };
  const unified = (before: string, after: string) => toUnified(diffText(before, after, opts));

  it('CRLF の行は、元の改行（CR）を付けて出力する（CRLF のファイルに git apply で適用できるように）', () => {
    expect(unified('a\r\nb\r\nc\r\n', 'a\r\nB\r\nc\r\n')).toBe('--- before\n+++ after\n@@ -1,3 +1,3 @@\n a\r\n-b\r\n+B\r\n c\r\n');
  });

  it('改行が混在していても、行ごとに元の改行で出力する。LF のテキストは今までどおり', () => {
    expect(unified('a\r\nb\nc', 'a\r\nB\nc')).toBe('--- before\n+++ after\n@@ -1,3 +1,3 @@\n a\r\n-b\n+B\n c\n\\ No newline at end of file\n');
    expect(unified('a\nb\n', 'a\nB\n')).toBe('--- before\n+++ after\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n');
  });

  it('比較と表示は、これまでどおり改行の違いを無視する', () => {
    const r = diffText('a\r\nb\r\n', 'a\nb\n', opts);
    expect(r.identical).toBe(true);
    expect(r.rows.every((row) => !row.left?.text.includes('\r'))).toBe(true);
  });
});

describe('差分の行の分割', () => {
  it.each(LINE_BREAK_CASES)('$name を行の区切りにする', ({ text, lines }) => {
    expect(diffLines(text)).toEqual(lines);
    expect(crlfFlags(text)).toHaveLength(lines.length);
  });
});
