import { describe, expect, it } from 'vitest';
import entry from './styles.css?raw';

/** 実際の入口のimport順で、分割したCSSもすべて検査する。 */
const sources = import.meta.glob<string>('./styles/**/*.css', { query: '?raw', import: 'default', eager: true });
const css = [...entry.matchAll(/@import '([^']+)'[^;]*;/g)].map((match) => {
  const source = sources[match[1] ?? ''];
  if (source === undefined) throw new Error('CSSが見つかりません: ' + match[1]);
  return source;
}).join('\n');

/**
 * 色の変数（src/styles/theme.css・theme-status.css）から、ライト・ダークそれぞれの主な「文字と背景」の組み合わせが
 * コントラスト比 4.5:1 以上（WCAG AA の通常の文字の基準）を満たすことを確認する。
 */

const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
/** 手動でダークを選んだときのブロック。\@media の中と同じ値にする */
const MANUAL_DARK = /:root\[data-theme='dark'\]\s*\{([^}]*)\}/g;

/** ダークモードの \@media の中身と、それ以外（ライト）に分ける */
function splitThemes(source: string): { light: string; dark: string; manualDark: string } {
  const comments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const manualDark = [...comments.matchAll(MANUAL_DARK)].map((m) => m[1]).join('\n');
  const text = comments.replace(MANUAL_DARK, '');
  let light = '';
  let dark = '';
  let i = 0;
  for (;;) {
    const start = text.indexOf(DARK_MEDIA, i);
    if (start < 0) {
      light += text.slice(i);
      break;
    }
    light += text.slice(i, start);
    const open = text.indexOf('{', start);
    let depth = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    dark += text.slice(open + 1, j);
    i = j + 1;
  }
  return { light, dark, manualDark };
}

const variables = (text: string): Record<string, string> =>
  Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], (m[2] ?? '').toLowerCase()]));

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((p) => {
    const v = parseInt(hex.slice(p, p + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const { light, dark, manualDark } = splitThemes(css);
const lightVars = variables(light);
const themes = { ライト: lightVars, ダーク: { ...lightVars, ...variables(dark) } };

/** [文字の変数, 背景の変数, 使われている場所] */
const PAIRS: [string, string, string][] = [
  ['text', 'bg', '本文'],
  ['text', 'surface', 'パネル・入力欄'],
  ['text', 'surface-2', '表の行など'],
  ['muted', 'bg', '説明文'],
  ['muted', 'surface', 'パネル内の補足'],
  ['muted', 'surface-2', '表の見出し・バッジ'],
  ['accent', 'bg', 'リンク'],
  ['accent', 'surface', 'リンク・強調'],
  ['accent', 'accent-soft', '選択中のツール・最近使ったツール'],
  ['accent', 'accent-soft', '正規表現のマッチ強調'],
  ['on-accent', 'accent', '選択中の切り替えボタン・主要なボタン・ロゴ'],
  ['good', 'good-soft', '「一致しました」などのお知らせ'],
  ['bad', 'bad-soft', 'エラー表示'],
  ['bad', 'bg', 'エラーの文字'],
  ['warn', 'warn-soft', '注意のお知らせ'],
  ['add', 'add-soft', '差分の追加行'],
  ['del', 'del-soft', '差分の削除行'],
  ['caution', 'bg', 'パスワードの強度「普通」'],
  ['caution', 'surface', 'パスワードの強度「普通」'],
  ['symbol', 'surface', 'パスワードの記号の色分け'],
  ['symbol', 'surface-2', 'パスワードの記号の色分け'],
];

describe('文字と背景のコントラスト（4.5:1 以上）', () => {
  it('ライトとダークの両方で変数を読み取れている', () => {
    expect(Object.keys(themes.ライト)).toEqual(expect.arrayContaining(['text', 'accent', 'on-accent', 'add']));
    expect(themes.ダーク.accent).not.toBe(themes.ライト.accent);
  });

  it('手動のダークは、OS の設定によるダークと同じ色を使う', () => {
    expect(variables(manualDark)).toEqual(variables(dark));
  });

  for (const [themeName, vars] of Object.entries(themes)) {
    it.each(PAIRS)(`${themeName}：--%s / --%s（%s）`, (fg, bg) => {
      expect(vars[fg], `--${fg} がない`).toBeDefined();
      expect(vars[bg], `--${bg} がない`).toBeDefined();
      expect(contrast(vars[fg]!, vars[bg]!)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('色は変数（--名前: #xxxxxx;）でだけ定義し、個別の指定に直接書かない（このテストで検査できるように）', () => {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const direct = text
      .split('\n')
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !/^\s*--[\w-]+:/.test(line))
      .map((line) => line.trim());
    expect(direct).toEqual([]);
  });

  it('計算方法：白と黒は 21:1、同じ色は 1:1', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#2563eb', '#2563eb')).toBe(1);
  });
});
