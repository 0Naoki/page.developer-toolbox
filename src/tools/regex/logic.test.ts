import { describe, expect, it } from 'vitest';
import { evaluateRegex, isStoredFlags, MAX_MATCHES, MAX_OUTPUT, MAX_PATTERN, MAX_TEXT, type RegexInput } from './logic';
import { limitMessage, MESSAGE_LIMIT } from '../../lib/text/textPreview';

const run = (patch: Partial<RegexInput> = {}) => evaluateRegex({ pattern: '(a)', flags: 'g', text: 'aba', replacement: '[$1]', ...patch });

describe('正規表現のマッチとキャプチャ', () => {
  it('すべてのマッチと番号・名前付きキャプチャの値と位置を返す', () => {
    const r = run({ pattern: '(?<name>\\w+)=(\\d+)', text: 'apple=12\nbanana=34' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0]).toEqual({ value: 'apple=12', start: 0, end: 8, captures: [
      { label: '$1', value: 'apple', start: 0, end: 5 },
      { label: '$2', value: '12', start: 6, end: 8 },
      { label: '$<name>', value: 'apple', start: 0, end: 5 },
    ] });
    expect(r.matches[1]?.start).toBe(9);
  });

  it('未参加のキャプチャと空文字のキャプチャを区別する', () => {
    const r = run({ pattern: '(a)?()', text: '' });
    expect(r.ok && r.matches[0]?.captures).toEqual([
      { label: '$1', value: null, start: null, end: null },
      { label: '$2', value: '', start: 0, end: 0 },
    ]);
  });

  it.each([
    ['a', '', 'Aa', 1], ['a', 'gi', 'Aa', 2], ['^a', 'gm', 'a\na', 2],
    ['a.b', 'gs', 'a\nb', 1], ['a', 'gy', 'aa a', 2], ['a', 'y', 'ba', 0],
    ['z', 'g', 'abc', 0], ['', 'g', 'ab', 3], ['', 'gu', '😀', 2],
    ['', 'g', '😀', 3], ['(?=a)', 'g', 'aa', 2],
  ])('式 %s、フラグ %s、入力 %s のマッチ数は %i', (pattern, flags, text, count) => {
    const r = run({ pattern, flags, text });
    expect(r.ok && r.matches.length).toBe(count);
  });

  it('構文エラー・重複フラグ・未知のフラグを例外にせず返す', () => {
    for (const input of [{ pattern: '[' }, { flags: 'gg' }, { flags: 'z' }]) expect(run(input).ok).toBe(false);
  });

  it('入力サイズとキャプチャ数の上限を検査する', () => {
    expect(run({ text: 'a'.repeat(MAX_TEXT + 1) })).toMatchObject({ ok: false });
    expect(run({ pattern: 'a'.repeat(MAX_PATTERN + 1) })).toMatchObject({ ok: false });
    expect(run({ replacement: 'a'.repeat(MAX_TEXT + 1) })).toMatchObject({ ok: false });
    expect(run({ pattern: '()'.repeat(51), text: '' })).toMatchObject({ ok: false });
  });

  it('回帰：長い正規表現の書き方の誤りでも、理由を表示の上限で切らない', () => {
    /** エンジンのエラーにパターンの全文が先に入り、表示の上限で末尾の理由が切れていた */
    const pattern = `(${'a'.repeat(5_000)}`;
    const r = run({ pattern, text: 'a' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const shown = limitMessage(r.error);
    expect(shown).toContain('正規表現の書き方に誤りがあります');
    /** 理由（Chromium・Node は「Unterminated group」）が、表示する文言の中に残る */
    expect(shown).toContain('Unterminated group');
    expect(r.error.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    /** 短い正規表現は、全文をそのまま示す */
    const short = run({ pattern: 'a{2,1}', text: 'a' });
    expect(!short.ok && short.error).toBe('正規表現の書き方に誤りがあります：numbers out of order in {} quantifier（正規表現：a{2,1}）');
  });

  it('表示は先頭だけに制限し、置換はすべてのマッチに適用する', () => {
    const r = run({ text: 'a'.repeat(MAX_MATCHES + 1) + '-', replacement: 'b' });
    expect(r).toMatchObject({ ok: true, truncated: true, total: MAX_MATCHES + 1, output: 'b'.repeat(MAX_MATCHES + 1) + '-', replacementError: null });
    expect(r.ok && r.matches).toHaveLength(MAX_MATCHES);
    expect(run({ text: 'a'.repeat(MAX_MATCHES) })).toMatchObject({ ok: true, truncated: false, total: MAX_MATCHES });
  });

  it('表示の上限を超えた後の置換が長引くときは、表示分を返して不完全な置換結果を出さない', () => {
    const r = evaluateRegex({ pattern: 'a', flags: 'g', text: 'a'.repeat(MAX_MATCHES + 1), replacement: 'b' }, -1);
    expect(r).toMatchObject({ ok: true, truncated: true, total: null, output: null, replacementError: expect.stringContaining('省略') });
    expect(r.ok && r.matches).toHaveLength(MAX_MATCHES);
  });

  it('表示の上限を超えた分も、置換結果の上限で止める', () => {
    const r = run({ text: 'a'.repeat(MAX_MATCHES * 2), replacement: 'b'.repeat(MAX_OUTPUT / MAX_MATCHES) });
    expect(r).toMatchObject({ ok: true, output: null, replacementError: expect.stringContaining('大きすぎます') });
  });

  it('キャプチャの合計サイズが大きすぎる場合は結果の転送を止める', () => {
    expect(run({ pattern: '(?=(.*))'.repeat(20), text: 'x'.repeat(MAX_TEXT) })).toMatchObject({ ok: false });
  });
});

describe('保存したフラグの検証', () => {
  it('選べるフラグだけからなり、重複のない文字列を受け付ける（空文字はすべて外した状態）', () => {
    for (const ok of ['', 'g', 'gi', 'yusmig']) expect(isStoredFlags(ok), ok).toBe(true);
  });

  it('選べないフラグ・重複・文字列以外は受け付けず、既定値に戻す', () => {
    /** "invalid" を受け付けると、i だけを拾って g がオフになる */
    for (const bad of ['invalid', 'gg', 'd', 'G', 'gimsuyg', ' g', 1, null, ['g']]) expect(isStoredFlags(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('置換プレビュー', () => {
  it.each([
    ['$1', '(a)', 'g', 'aba'], ['$$ $& $` $\'', '(a)', 'g', 'aba'],
    ['$01-$0-$00-$10-$12-$99', '(a)', 'g', 'aba'], ['$2', '(a)(b)?', 'g', 'aa'],
    ['$<name>/$<missing>', '(?<name>a)', 'g', 'aba'], ['$<name>', '(a)', 'g', 'aba'],
    ['$<$1>', '(a)', 'g', 'a'], ['$<$$>', '(a)', 'g', 'a'],
    ['$<$&>', 'a', 'g', 'aba'], ['$<prefix$1>', '(a)', 'g', 'aba'],
    ['$<$1>', '(?<name>a)', 'g', 'a'], ['$<$$>', '(?<name>a)', 'g', 'a'],
    ['$1', '(a)', '', 'aba'], ['X', '', 'gu', '😀'], ['X', '', 'g', 'ab'],
    ['X', 'a', 'gy', 'aa a'], ['$<__proto__>', '(?<__proto__>a)', 'g', 'aba'],
    ['X', '(?<=a)b', 'g', 'ab'], ['X', 'z', 'g', 'abc'], ['', 'a', 'g', 'aba'],
    ['X', '', 'g', ''], ['', '', 'g', ''],
    ['$<', '(?<x>a)', 'g', 'aba'], ['$<x', '(?<x>a)', 'g', 'aba'], ['$<$<x>', '(?<x>a)', 'g', 'aba'],
    ['$<<x>>', '(?<x>a)', 'g', 'a'], ['$', '(a)', 'g', 'aba'], ['a$', '(a)', 'g', 'aba'], ['$1$', '(a)', 'g', 'a'],
    ['$x$<x>$1', '(?<x>a)', 'g', 'a'], ['$<', '(a)', 'g', 'a'],
  ])('置換 %s、式 %s、フラグ %s、入力 %s は String.replace と一致する', (replacement, pattern, flags, text) => {
    const r = run({ replacement, pattern, flags, text });
    expect(r.ok && r.output).toBe(text.replace(new RegExp(pattern, flags), replacement));
  });

  it('大きな置換結果を止めても、マッチ結果は表示できる', () => {
    const r = run({ text: 'a'.repeat(20), replacement: 'x'.repeat(MAX_TEXT) });
    expect(r).toMatchObject({ ok: true, output: null, replacementError: expect.stringContaining('大きすぎます') });
    expect(r.ok && r.matches).toHaveLength(20);
    const boundary = run({ text: 'a'.repeat(10), replacement: 'x'.repeat(MAX_TEXT) });
    expect(boundary.ok && boundary.output?.length).toBe(MAX_OUTPUT);
  });

  it('閉じる > のない $< が多い置換文字列も、入力の長さに比例する時間で解析する', () => {
    /** $\< のたびに末尾まで \> を探し直すと計算量が2乗になり、5万個で数秒かかる（画面の Worker は2秒で打ち切る） */
    const replacement = '$<'.repeat(50_000);
    const r = run({ pattern: '(?<x>a)', text: 'a', replacement });
    expect(r.ok && r.output).toBe('a'.replace(/(?<x>a)/g, replacement));
    /**
     * 経過時間そのものは PC の負荷で変わるため、同じ長さで置換記法のない文字列にかかる時間との比で確かめる
     * （負荷がかかれば両方が同じように遅くなる。2乗の計算量なら数百倍以上になる）
     */
    const fastest = (replacement: string) => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        run({ pattern: '(?<x>a)', text: 'a', replacement });
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const plain = fastest('x'.repeat(replacement.length));
    expect(fastest(replacement)).toBeLessThan(Math.max(plain, 5) * 50);
  }, 60_000);

  it('置換記法の展開中も、前後の文字列を含めた出力上限を適用する', () => {
    const text = 'x'.repeat(MAX_TEXT - 2) + 'aa';
    const r = run({ text, replacement: '$`'.repeat(11) });
    expect(r).toMatchObject({ ok: true, output: null, replacementError: expect.stringContaining('大きすぎます') });
    expect(r.ok && r.matches).toHaveLength(2);
  });
});
