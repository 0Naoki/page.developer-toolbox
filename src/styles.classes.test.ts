/**
 * CSS のクラスの置き場所の検査。
 *
 * - ツール別の CSS（src/styles/<ツールのフォルダ名>.css）のクラスを、ほかのツール・画面で使わない
 * - 共通の CSS（部品の層）に、1つのツールやアプリの枠組みだけが使うクラスを置かない（そのツールの CSS・layout.css・home.css に置く）
 *
 * - 画面幅の切り替えは src/app/breakpoints.ts の値だけを使う（JavaScript の matchMedia と同じ値）
 * - src/styles/ のどのファイルも、入口（src/styles.css）で1回だけ、番号の見出しに合った cascade layers の層に入れて読み込む
 *
 * 部品を消したときに CSS を消し忘れたり、ツールを消したときに共通の CSS にそのツールの規則が残ったりしないようにする。
 */
import { describe, expect, it } from 'vitest';
import { cssLayers, definedClasses, ownerOf, usedClasses } from './cssClasses.testing';
import { BREAKPOINTS, SIDEBAR_SHOWN_QUERY } from './app/breakpoints';

const styles = import.meta.glob<string>('/src/styles/*.css', { query: '?raw', import: 'default', eager: true });
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts', '!/src/**/*.testing.ts', '!/src/**/*.fixtures.ts'], {
  query: '?raw', import: 'default', eager: true,
});
const entry = Object.values(import.meta.glob<string>('/src/styles.css', { query: '?raw', import: 'default', eager: true }))[0] ?? '';
const toolIds = new Set(Object.keys(import.meta.glob('/src/tools/*/index.tsx')).map((f) => f.split('/')[3] ?? ''));

/**
 * 層の分け方は、入口（src/styles.css）の番号付きの見出しから読む（検査の側に一覧を持たない）。
 * 1. テーマの変数・2. 要素の基本・3. 部品・4. アプリの枠組み・5. ツール別・6. 縦の並びの余白
 */
const LAYER = { theme: 1, base: 2, parts: 3, app: 4, tool: 5, stack: 6 } as const;
/** 番号の見出しごとの、cascade layers の層の名前（入口の `@layer` の宣言と同じ順） */
const LAYER_NAMES: Record<number, string> = { 1: 'theme', 2: 'base', 3: 'parts', 4: 'app', 5: 'tools', 6: 'stack' };
const { headings, layers, layerNames } = cssLayers(entry);
const filesIn = (...numbers: number[]) => new Set([...layers].filter(([, n]) => numbers.includes(n)).map(([f]) => f));
/** アプリの枠組み（サイドバー・トップページ）の CSS。app だけが使うクラスを置く */
const APP_FILES = filesIn(LAYER.app);
/** ツール別以外の共通の CSS。2つ以上の画面、または共通の部品（src/components/）が使うクラスを置く */
const SHARED_FILES = filesIn(LAYER.theme, LAYER.base, LAYER.parts, LAYER.stack);

/** 規則の例外（「ファイル .クラス」と理由）。使わなくなった例外は検査で失敗する */
const ALLOWED: Record<string, string> = {
  'text.css .sub-title': '見出しの部品。stack.css の余白の規則が、見出しとして名前で参照する（.section-title と同じ扱い）',
  'stack.css .sub-title': '余白の規則が、見出しを名前で除外する',
  'forms.css .lv0': 'メーター（.meter-fill）の段階。パスワード生成の強度（段階を `lv${n}` で組み立てる）とハッシュの進捗（lv3）で共有し、使う段階が画面によって違う',
  'forms.css .lv1': '強度のメーター（.meter-fill）の段階（.lv0 と同じ）',
  'forms.css .lv2': '強度のメーター（.meter-fill）の段階（.lv0 と同じ）',
  'business-days.css .on': '選んだ状態の修飾子。各ツールのクラスと組み合わせて（.day-toggle.on など）だけ使う',
  'password-generator.css .on': '選んだ状態の修飾子。各ツールのクラスと組み合わせて（.toggle.on など）だけ使う',
  'radix.css .on': '選んだ状態の修飾子。各ツールのクラスと組み合わせて（.bit.on など）だけ使う',
};

const fileName = (path: string) => path.split('/').pop() ?? '';
const used = Object.entries(sources).map(([file, code]) => ({ owner: ownerOf(file), ...usedClasses(code) }));
/** クラスを使う画面の名前の集まり（名前の先頭だけが分かる使い方も含む） */
const ownersOf = (cls: string) => new Set(used.filter((u) => u.names.has(cls) || [...u.prefixes].some((p) => cls.startsWith(p))).map((u) => u.owner));
const sharedClasses = new Set(Object.entries(styles).filter(([f]) => SHARED_FILES.has(fileName(f))).flatMap(([, css]) => [...definedClasses(css)]));

describe('CSS のクラスと、それを使う画面の対応の解析', () => {
  it('className 属性とクラスを組み立てる変数の中の単語を、クラスとして読む', () => {
    const code = [
      '<div className="pane wide">',
      "<span className={ok ? 'badge good' : 'badge'} />",
      '<td className={`ln ${cls}`} />',
      "const classes = ['notice', `badge-${tone}`, small ? 'badge-small' : null];",
    ].join('\n');
    const { names, prefixes } = usedClasses(code);
    expect([...names].sort()).toEqual(['badge', 'badge-small', 'good', 'ln', 'notice', 'pane', 'wide']);
    expect([...prefixes]).toEqual(['badge-']);
  });

  it('className 以外の文字列の単語は、クラスとして読まない', () => {
    const { names, prefixes } = usedClasses("const label = 'match empty sign'; setError(`bit ${n}`); <Pane title=\"card\" />");
    expect([...names]).toEqual([]);
    expect([...prefixes]).toEqual([]);
  });

  it('CSS のセレクタのクラスを読み、コメントと @media の条件は読まない', () => {
    const css = '/* .ignored */ .a .b, .c:hover { x: 1 } @media (max-width: 960px) { .d { x: 1 } } .e.f[aria-pressed=\'true\'] { x: 1 }';
    expect([...definedClasses(css)].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('CSS のクラスの置き場所', () => {
  const problems: string[] = [];
  const usedAllowances = new Set<string>();
  const check = (key: string, problem: string) => {
    if (key in ALLOWED) usedAllowances.add(key);
    else problems.push(`${key}：${problem}`);
  };
  for (const [path, css] of Object.entries(styles)) {
    const file = fileName(path);
    const tool = file.replace(/\.css$/, '');
    for (const cls of definedClasses(css)) {
      const owners = [...ownersOf(cls)].sort();
      const key = `${file} .${cls}`;
      if (SHARED_FILES.has(file)) {
        if (owners.length === 1 && owners[0] !== 'components' && owners[0] !== 'other') check(key, `${owners[0]} だけが使う（${owners[0] === 'app' ? 'layout.css・home.css' : `${owners[0]}.css`} に移す）`);
      } else if (APP_FILES.has(file)) {
        /** 部品の層のクラス（.seg・.link-btn など）を、枠組みの中で組み合わせて使う規則は対象外 */
        if (!sharedClasses.has(cls) && owners.some((o) => o !== 'app')) check(key, `アプリの枠組み以外（${owners.join('・')}）が使う（部品の層の CSS に移す）`);
      } else if (!sharedClasses.has(cls) && owners.some((o) => o !== tool)) {
        check(key, `ほかの画面（${owners.filter((o) => o !== tool).join('・')}）も使う（部品の層の CSS に移す）`);
      }
    }
  }

  it('ツール別の層の CSS のファイル名が、ツールのフォルダ名と同じ（ツールのフォルダ名の CSS は、ツール別の層に置く）', () => {
    const toolLayer = filesIn(LAYER.tool);
    expect([...toolLayer].filter((f) => !toolIds.has(f.replace(/\.css$/, ''))), 'ツール別の層にある、ツールの名前でないファイル').toEqual([]);
    expect([...layers.keys()].filter((f) => toolIds.has(f.replace(/\.css$/, '')) && !toolLayer.has(f)), 'ツール別の層の外にある、ツールの名前のファイル').toEqual([]);
  });

  it('クラスを、使う画面の範囲に合った CSS に置いている', () => {
    expect(problems).toEqual([]);
  });

  it('規則の例外は、どれもまだ使われている', () => {
    expect(Object.keys(ALLOWED).filter((key) => !usedAllowances.has(key))).toEqual([]);
  });
});

describe('CSS の読み込み', () => {
  const imports = [...layers.keys()];
  const layerOf = (file: string): number => layers.get(file) ?? 0;

  it('入口の層の見出しの読み方：番号付きの見出しの後の読み込みを、その層のファイルにする', () => {
    const example = cssLayers("/* 説明 */\n/* 1. テーマ */\n@import './styles/a.css' layer(theme);\n\n/* 3. 部品 */\n@import './styles/b.css' layer(parts);\n@import './styles/c.css';");
    expect(example.headings).toEqual([1, 3]);
    expect([...example.layers]).toEqual([['a.css', 1], ['b.css', 3], ['c.css', 3]]);
    expect([...example.layerNames]).toEqual([['a.css', 'theme'], ['b.css', 'parts'], ['c.css', '']]);
  });

  it('入口に、層の見出しが 1〜6 の順に1つずつあり、どの読み込みもいずれかの層の中にある', () => {
    expect(headings).toEqual(Object.values(LAYER));
    expect(imports.filter((f) => layerOf(f) === 0), '層の見出しより前の読み込み').toEqual([]);
  });

  it('src/styles/ のどのファイルも、入口で1回だけ読み込む（読み込み忘れたファイルの規則は、本番でまったく効かない）', () => {
    const files = Object.keys(styles).map(fileName).sort();
    expect(files.filter((f) => !imports.includes(f)), '読み込んでいないファイル').toEqual([]);
    expect(imports.filter((f, i) => imports.indexOf(f) !== i), '2回以上読み込んでいるファイル').toEqual([]);
    expect(imports.filter((f) => !files.includes(f)), '存在しないファイル').toEqual([]);
  });

  it('どの読み込みも、見出しの番号に合った層（layer(...)）に入れている（層に入れない規則は、どの層の規則よりも優先されてしまう）', () => {
    expect(imports.filter((f) => layerNames.get(f) !== LAYER_NAMES[layerOf(f)]).map((f) => `${f} layer(${layerNames.get(f)})`)).toEqual([]);
  });

  it('入口の `@layer` の宣言が、見出しの番号の順に層を並べている（後の層ほど優先される）', () => {
    const declared = /^@layer ([^;]+);/m.exec(entry)?.[1]?.split(',').map((name) => name.trim());
    expect(declared).toEqual(Object.values(LAYER_NAMES));
  });

  it('層の見出しの番号の順に読み込む（入口を読んだときに、優先の順が分かるように）', () => {
    const outOfOrder = imports.filter((f, i) => i > 0 && layerOf(f) < layerOf(imports[i - 1] ?? ''));
    expect(outOfOrder, '前のファイルより前の層のファイル').toEqual([]);
  });
});

describe('CSS の画面幅の切り替え', () => {
  /** @media の条件と、その中の規則の本文 */
  const mediaBlocks = (css: string) => {
    const out: { query: string; body: string }[] = [];
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/@media\s*([^{]+)\{/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < text.length && depth > 0; i++) depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
      out.push({ query: (m[1] ?? '').trim(), body: text.slice(m.index + m[0].length, i - 1) });
    }
    return out;
  };
  const widthQueries = Object.entries(styles).flatMap(([path, css]) =>
    mediaBlocks(css).filter((b) => /width/.test(b.query)).map((b) => ({ file: fileName(path), ...b })));

  it('切り替えの幅は、src/app/breakpoints.ts の BREAKPOINTS の値だけを使う（JavaScript の matchMedia と食い違わないように）', () => {
    const allowed = new Set<string>(Object.values(BREAKPOINTS).map((px) => `(max-width: ${px}px)`));
    expect(widthQueries.filter((b) => !allowed.has(b.query)).map((b) => `${b.file}：@media ${b.query}`)).toEqual([]);
  });

  it('サイドバーをメニューにたたむ幅（layout.css）が、メニューを閉じる処理の幅（SIDEBAR_SHOWN_QUERY）とつながっている', () => {
    const menu = widthQueries.find((b) => b.file === 'layout.css' && /\.menu-toggle\b/.test(b.body));
    expect(menu?.query).toBe(`(max-width: ${BREAKPOINTS.menu}px)`);
    expect(SIDEBAR_SHOWN_QUERY).toBe(`(min-width: ${BREAKPOINTS.menu + 1}px)`);
  });
});
