import { parseSync } from 'rolldown/experimental';

/**
 * 静的検査（src/architecture.test.ts）が使う、ソースの解析。
 *
 * @remarks
 * 「*.testing.ts」はテストからだけ読み込む補助で、アプリのソースとしての検査の対象外（architecture.test.ts の glob で除く）。
 * 1つのファイルは1回だけ解析し、コメントを除いたコードと構文木を、すべての規則で使い回す。
 */

type AstNode = { type: string; name?: unknown; value?: unknown; computed?: boolean; start: number };

/** 検査に使う、ファイルの解析結果 */
export type ParsedSource = {
  /** コメントを除いたコード（説明のコメントに API の名前を書いても失敗しないように） */
  code: string;
  /** 構文木 */
  program: unknown;
};

/** 例として渡す断片のファイル名（解析の結果を使い回さない） */
const SNIPPET = 'snippet.tsx';
const cache = new Map<string, ParsedSource>();

/**
 * ソースを解析し、コメントを除いたコードと構文木を返す。
 *
 * @remarks
 * 正規表現でコメントを消すと、文字列の中の「/*」「//」（`'a//b'` など）をコメントの始まりと誤り、後ろのコードまで消して
 * fetch などを見逃す。構文解析（Vite が使う rolldown の parseSync）でコメントの位置を求め、その範囲だけを消す。
 *
 * @throws 解析できないソース（検査を素通りさせずに失敗させる）
 */
export function parseSource(source: string, file = SNIPPET): ParsedSource {
  const cached = file === SNIPPET ? undefined : cache.get(file);
  if (cached) return cached;
  const { program, comments, errors } = parseSync(file, source);
  if (errors.length > 0) throw new Error(`${file} を解析できません：${errors[0]?.message ?? ''}`);
  let code = '';
  let at = 0;
  for (const comment of comments) {
    code += source.slice(at, comment.start) + ' ';
    at = comment.end;
  }
  code += source.slice(at);
  const parsed = { code, program };
  if (file !== SNIPPET) cache.set(file, parsed);
  return parsed;
}

/** コメントを除いたコード */
export const codeOf = (source: string, file = SNIPPET): string => parseSource(source, file).code;

/**
 * 外部と通信する API の名前。呼び出しの形（fetch(...)）だけでなく、変数に入れる・window['fetch'] のように
 * 文字列で参照するなど、どの形で参照しても検出する（connect-src 'none' は開発サーバーでは効かないため）。
 * WebRTC（RTCPeerConnection など）は本番の CSP でも塞げず、E2E の通信の監視（e2e/watch.ts）にも現れないため、ここで止める
 */
export const NETWORK_NAMES = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'sendBeacon', 'WebTransport',
  'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel',
]);

/**
 * 通信の API を持つグローバルなオブジェクト。これらを動的なキー（window[name]・window['fe' + 'tch'] など）で参照したり、
 * Reflect・Object.getOwnPropertyDescriptor などに渡したりすると、名前を書かずに通信の API を取り出せるため、それ自体を検出する
 */
const GLOBAL_OBJECTS = new Set(['window', 'self', 'globalThis', 'navigator', 'top', 'parent', 'frames']);

/** 第1引数のオブジェクトのプロパティを、キーの名前で取り出せる関数（Reflect.get(window, 'fetch') など） */
const PROPERTY_READERS: Record<string, Set<string>> = {
  Reflect: new Set(['get', 'getOwnPropertyDescriptor', 'ownKeys']),
  Object: new Set(['getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'entries', 'values']),
};

/** オブジェクトや型のキーとしての名前（{ fetch: 1 } など）。API の参照ではない */
const KEY_PARENTS = new Set(['Property', 'PropertyDefinition', 'MethodDefinition', 'TSPropertySignature', 'TSMethodSignature']);

type MemberNode = AstNode & { object?: AstNode & { property?: AstNode }; property?: AstNode };
type CallNode = AstNode & { callee?: MemberNode; arguments?: AstNode[] };

/** グローバルなオブジェクト（window、または window.navigator のような、その名前のプロパティ）か */
function isGlobalObject(node: AstNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'Identifier') return typeof node.name === 'string' && GLOBAL_OBJECTS.has(node.name);
  const member = node as MemberNode;
  return node.type === 'MemberExpression' && !member.computed && member.property?.type === 'Identifier'
    && typeof member.property.name === 'string' && GLOBAL_OBJECTS.has(member.property.name);
}

/** グローバルなオブジェクトを、静的に決まらないキーで参照しているか（window[0] のような数値のキーは除く） */
function isDynamicGlobalAccess(node: AstNode): boolean {
  const member = node as MemberNode;
  if (node.type !== 'MemberExpression' || member.computed !== true || !isGlobalObject(member.object)) return false;
  const key = member.property;
  return staticString(key) === null && !(key?.type === 'Literal' && typeof key.value === 'number');
}

/** グローバルなオブジェクトを、キーの名前でプロパティを取り出す関数に渡しているか（Reflect.get(window, name) など） */
function isGlobalPropertyRead(node: AstNode): boolean {
  const call = node as CallNode;
  const callee = call.callee;
  if (node.type !== 'CallExpression' || callee?.type !== 'MemberExpression' || callee.computed) return false;
  const owner = callee.object?.type === 'Identifier' ? callee.object.name : undefined;
  const method = callee.property?.type === 'Identifier' ? callee.property.name : undefined;
  return typeof owner === 'string' && typeof method === 'string' && PROPERTY_READERS[owner]?.has(method) === true
    && isGlobalObject(call.arguments?.[0]);
}

/**
 * 構文木から、通信の API を参照している箇所を探す。文字列・コメント・JSX の属性名は対象外。
 * 分割代入（const { fetch: send } = window）のキーは、取り出す元の名前なので参照として数える。
 * 名前の文字列（式を含まないテンプレートを含む）は、計算したプロパティのキー・分割代入のキー・関数の引数（Reflect.get(window, 'fetch')）を数える。
 * グローバルなオブジェクトへの動的なキーでの参照は、取り出す名前が分からないため、名前によらず数える
 */
export function networkReferences(source: string, file = SNIPPET): string[] {
  const { program } = parseSource(source, file);
  /** 省略形の分割代入（{ fetch }）はキーと値が同じ位置を指すため、位置ごとに1回だけ数える */
  const found = new Map<number, string>();
  const visit = (value: unknown, parent: AstNode | null, key: string, grandparent: AstNode | null) => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, parent, key, grandparent);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as AstNode;
    if (typeof node.type === 'string') {
      const patternKey = parent?.type === 'Property' && grandparent?.type === 'ObjectPattern' && key === 'key';
      const asName = node.type === 'Identifier' && typeof node.name === 'string' && NETWORK_NAMES.has(node.name)
        && (patternKey || !(parent && KEY_PARENTS.has(parent.type) && key === 'key' && !parent.computed));
      const text = staticString(node);
      const asString = text !== null && NETWORK_NAMES.has(text)
        && (patternKey
          || (parent?.type === 'MemberExpression' && key === 'property' && parent.computed === true)
          || ((parent?.type === 'CallExpression' || parent?.type === 'NewExpression') && key === 'arguments'));
      if (asName) found.set(node.start, `${file}：${String(node.name)}（${node.start}文字目）`);
      else if (asString) found.set(node.start, `${file}：${text}（${node.start}文字目）`);
      else if (isDynamicGlobalAccess(node)) found.set(node.start, `${file}：グローバルなオブジェクトへの動的なキーでの参照（${node.start}文字目）`);
      else if (isGlobalPropertyRead(node)) found.set(node.start, `${file}：グローバルなオブジェクトのプロパティの取り出し（${node.start}文字目）`);
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (child && typeof child === 'object') {
        const isNode = typeof node.type === 'string';
        visit(child, isNode ? node : parent, childKey, isNode ? parent : grandparent);
      }
    }
  };
  visit(program, null, '', null);
  return [...found.values()];
}

/**
 * 文字列リテラルと、式を含まないテンプレートだけを、静的に決まる文字列として読む（モジュールのパス・プロパティのキー）。
 * 実行時の値は推測しない。
 */
function staticString(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as AstNode & { expressions?: unknown[]; quasis?: { value?: { cooked?: unknown } }[] };
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0 && node.quasis?.length === 1) {
    const cooked = node.quasis[0]?.value?.cooked;
    if (typeof cooked === 'string') return cooked;
  }
  return null;
}

/** 静的 import・再エクスポート・動的 import のローカル参照を、ソース内のパス（/src/...）にそろえる */
export function localImports(file: string, source: string): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as AstNode & { source?: AstNode };
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression', 'TSImportType'].includes(node.type)) {
      const spec = staticString(node.source);
      if (typeof spec === 'string' && (spec.startsWith('.') || spec.startsWith('/src/'))) {
        found.push(new URL(spec, `http://repo${file}`).pathname);
      }
    }
    for (const child of Object.values(node)) if (child && typeof child === 'object') visit(child);
  };
  visit(parseSource(source, file).program);
  return found;
}
