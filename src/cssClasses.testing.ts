/**
 * CSS のクラスと、それを使う画面の対応の解析（src/styles.classes.test.ts が使う）。
 *
 * @remarks
 * 「*.testing.ts」はテストからだけ読み込む補助で、アプリのソースとしての検査の対象外。
 */

/** 文字列リテラル（' " `）の位置と中身。テンプレートの `${` の直前で切った断片は prefix にする */
function literals(code: string): { text: string; prefixes: string[] }[] {
  const found: { text: string; prefixes: string[] }[] = [];
  for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    if (m[3] === undefined) {
      found.push({ text: m[1] ?? m[2] ?? '', prefixes: [] });
      continue;
    }
    /** `badge-${tone}` の badge- のように、式の直前で切れた単語は、その単語で始まるクラスとして扱う */
    const parts = m[3].split(/\$\{[^}]*\}/);
    const prefixes = parts.slice(0, -1).map((part) => /(\S+)$/.exec(part)?.[1] ?? '').filter(Boolean);
    found.push({ text: parts.map((part, i) => (i < parts.length - 1 ? part.replace(/\S+$/, '') : part)).join(' '), prefixes });
  }
  return found;
}

/** 開き括弧 open の位置から、対応する閉じ括弧までの文字列 */
function balanced(code: string, open: number): string {
  const pair: Record<string, string> = { '{': '}', '[': ']' };
  const close = pair[code[open] ?? ''];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === code[open]) depth++;
    else if (code[i] === close && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

/**
 * ソースで使うクラスの名前（完全な名前）と、名前の先頭（`badge-${tone}` の badge-）。
 *
 * @remarks
 * 読むのは、className 属性（`className="a b"`・`className={…}` の中の文字列）と、クラスを組み立てる変数
 * （`const classes = […]`・`const className = […]`）の中の文字列だけ。ほかの文字列の単語はクラスとみなさない。
 */
export function usedClasses(code: string): { names: Set<string>; prefixes: Set<string> } {
  const names = new Set<string>();
  const prefixes = new Set<string>();
  const add = (fragment: string) => {
    for (const { text, prefixes: p } of literals(fragment)) {
      for (const word of text.split(/\s+/)) if (/^[a-z][\w-]*$/.test(word)) names.add(word);
      for (const word of p) prefixes.add(word);
    }
  };
  for (const m of code.matchAll(/\bclassName=(?=["'{])/g)) {
    const at = m.index + m[0].length;
    add(code[at] === '{' ? balanced(code, at) : (/^(["'])[^"']*\1/.exec(code.slice(at))?.[0] ?? ''));
  }
  for (const m of code.matchAll(/\bconst (?:classes|className) = (?=[[{'"`])/g)) {
    const at = m.index + m[0].length;
    add(code[at] === '[' || code[at] === '{' ? balanced(code, at) : (/^(["'`])[^\n]*?\1/.exec(code.slice(at))?.[0] ?? ''));
  }
  return { names, prefixes };
}

/** CSS のセレクタに出てくるクラスの名前（コメントと @media などの条件を除く） */
export function definedClasses(css: string): Set<string> {
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1] ?? '').filter((s) => !s.trim().startsWith('@'));
  return new Set(selectors.flatMap((s) => [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? '')));
}

/** ソースのパス（/src/...）から、そのクラスを使う側の名前（ツールの ID のフォルダ名・app・components） */
export function ownerOf(file: string): string {
  const tool = /^\/src\/tools\/([^/]+)\//.exec(file);
  if (tool) return tool[1] ?? '';
  if (file.startsWith('/src/app/') || file === '/src/App.tsx' || file === '/src/main.tsx') return 'app';
  if (file.startsWith('/src/components/')) return 'components';
  return 'other';
}

/**
 * CSS の入口（src/styles.css）の層。`/* 3. ツールをまたいで使う部品 … *\/` のような番号付きの見出しの後に並ぶ `@import` を、その層のファイルとして読む。
 *
 * @remarks
 * どのファイルがどの層かは、入口のファイルにだけ書く（検査の側に一覧を持つと、ファイルを足したときに2か所を直すことになる）。
 *
 * @returns 層の番号を見出しの順に並べたもの（headings）と、ファイル名から層の番号（layers）。見出しより前の読み込みは層 0。
 */
export function cssLayers(entry: string): { headings: number[]; layers: Map<string, number>; layerNames: Map<string, string> } {
  const headings: number[] = [];
  const layers = new Map<string, number>();
  /** 読み込みに付けた cascade layers の層の名前（`@import '…' layer(parts);` の parts）。付けていなければ空文字 */
  const layerNames = new Map<string, string>();
  let current = 0;
  for (const line of entry.split('\n')) {
    const heading = /^\/\*\s*(\d+)\.\s/.exec(line);
    if (heading) {
      current = Number(heading[1]);
      headings.push(current);
      continue;
    }
    const found = /^@import '\.\/styles\/([^']+)'(?: layer\((\w+)\))?;/.exec(line);
    const file = found?.[1];
    if (file) {
      layers.set(file, current);
      layerNames.set(file, found?.[2] ?? '');
    }
  }
  return { headings, layers, layerNames };
}
