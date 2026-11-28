/**
 * 静的検査（src/architecture.test.ts）の規則。コードの書き方の規則（SOURCE_RULES）と、import の向きの規則（IMPORT_RULES）がある。
 *
 * @remarks
 * どの規則も、検出すべき書き方（detects）と、検出してはいけない書き方（ignores）を対で持つ。
 * 規則を足すときは、両方の例を書く（例が通らない規則は、アプリのソースでも素通りする恐れがある）。
 * 直し方（fix）は、検査が失敗したときに表示する。規則の一覧・理由・直し方は、このファイルだけに書く（TESTING.md には書かない）。
 * 規則の例外（allowed）には理由を書く。使わなくなった例外は検査で失敗する。
 * 外部と通信する API（fetch・XMLHttpRequest など）は、ここの正規表現ではなく、構文木からどの形の参照でも探す
 * 解析の処理（src/sourceScan.testing.ts の networkReferences）で検査する。正規表現の規則より検出の範囲が広い
 * （変数に入れる・`window['fetch']`・分割代入・WebTransport・WebRTC・グローバルなオブジェクトへの動的なキーでの参照も見つける）ため、二重には持たない。
 */
export type SourceRule = {
  /** 規則の名前（テストの名前になる） */
  name: string;
  /** 直し方（検査が失敗したときに表示する） */
  fix: string;
  /** 検出する書き方（コメントを除いたコードに対して調べる） */
  pattern: RegExp;
  /** 規則を当てるファイル（省略するとすべて） */
  appliesTo?: (file: string) => boolean;
  /**
   * 見つけた箇所ごとに名前を付ける（ファイル単位ではなく箇所単位で例外にする規則だけ）。
   * null を返した箇所は規則に反しない。指定すると、allowed のキーは「ファイル 名前」になる
   */
  label?: (match: string) => string | null;
  /** 規則の例外にするファイル（label があれば「ファイル 名前」）と、その理由。使わなくなった例外は検査で失敗する */
  allowed?: Record<string, string>;
  /** 検出すべき書き方の例 */
  detects: string[];
  /** 検出してはいけない書き方の例（正しい書き方・紛らわしい書き方） */
  ignores: string[];
};

export const SOURCE_RULES: SourceRule[] = [
  /** 使ってはいけない API。本番では CSP（Trusted Types を含む）で拒否されるが、開発サーバーでは動いてしまうため、ソースの段階で止める */
  {
    name: '入力内容を HTML として挿入しない',
    fix: 'テキストとして表示する書き方（textContent・JSX の {text}）に直す',
    /** 入力内容はテキストとして表示する。本番では Trusted Types で拒否されてエラーになる */
    pattern: /\.(?:inner|outer)HTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b|\bdangerouslySetInnerHTML\b/,
    detects: ['el.innerHTML = text', 'el.outerHTML = text', "el.insertAdjacentHTML('beforeend', text)", 'document.write(text)', '<div dangerouslySetInnerHTML={{ __html: text }} />'],
    ignores: ['el.textContent = text', '<div>{text}</div>', '/** innerHTML は使わない */ const a = 1;'],
  },
  {
    name: '文字列をコードとして実行しない',
    fix: 'eval・new Function を使わない書き方に直す',
    /** CSP の script-src で実行が禁止されているため、本番では動かない */
    pattern: /\beval\s*\(|\bnew\s+Function\b/,
    detects: ['eval(code)', "const f = new Function('a', 'return a');"],
    ignores: ['const evaluate = (x: number) => x;', 'const medieval = 1;', 'function run() {}'],
  },
  {
    name: '乱数は crypto.getRandomValues を使う',
    fix: 'src/lib/random.ts の cryptoRng を使う',
    /** Math.random は予測できるため、パスワード・UUID などに使うと安全でない。テストの入力づくり（*.test.ts）は検査の対象外 */
    pattern: /\bMath\.random\s*\(/,
    detects: ['const n = Math.floor(Math.random() * 10);'],
    ignores: ['cryptoRng(buffer);', 'crypto.getRandomValues(buffer);', '/** Math.random() は使わない */ const a = 1;'],
  },
  {
    name: 'Worker は ?worker-source と createTrustedWorker で起動する',
    fix: '?worker-source で読み込んだコードを createTrustedWorker で起動する',
    /**
     * URL から読み込んだ Worker にはページの CSP が適用されないため、?worker・?worker&url は使わない。
     * new Worker(new URL(…)) で直接起動する書き方も、Trusted Types のポリシーを通らないため止める（本番では CSP の worker-src blob: でも止まる）
     */
    pattern: /\?worker(?:&url)?['"]|\bnew\s+Worker\s*\(/,
    allowed: { '/src/lib/worker/createTrustedWorker.ts': 'Worker を起動する共通の処理そのもの' },
    detects: ["import W from './worker?worker'", "import url from './worker?worker&url'", "const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });"],
    ignores: ["import source from './worker?worker-source'", "const label = 'worker';", 'const worker = createTrustedWorker(policy, source);'],
  },
  {
    name: 'エラー表示は ErrorText・ErrorBox を通し、文言の長さを表示の側でも制限する',
    fix: 'ErrorText・ErrorBox を使う（入力を含む文言は message・detail で渡す）',
    /** エラーの文言には入力が入ることがあり、入力欄のプレビュー制限を迂回して全文描画しないよう、クラス名を直接書かせない */
    pattern: /\berror-(?:text|box)\b/,
    appliesTo: (file) => file.endsWith('.tsx'),
    allowed: { '/src/components/ErrorMessage.tsx': '共通の部品そのもの' },
    detects: ['<p className="error-text">{message}</p>', "<div className='error-box'>{e}</div>"],
    ignores: ['<ErrorText message={message} />', '<ErrorBox title="変換できません" message={error} />'],
  },
  {
    name: '案内・警告は Notice を通し、文言の長さを表示の側でも制限する',
    fix: 'Notice を使う（入力を含み得る文言は message で渡す）',
    /** 警告の文言にも入力が入ることがあるため、エラーと同じく、クラス名を直接書かせずに表示の側の上限を通す */
    pattern: /['"`](?:[\w-]+\s+)*notice(?=[\s'"`])/,
    appliesTo: (file) => file.endsWith('.tsx'),
    allowed: { '/src/components/Notice.tsx': '共通の部品そのもの' },
    detects: ['<div className="notice warn">{w}</div>', "<div className={ok ? 'notice good' : 'notice bad'} />", '<div className={`notice ${tone}`} />', '<div className="stack notice warn">{w}</div>'],
    ignores: ['<Notice tone="warn" message={w} />', '<div className="notice-list" />', '<Notice tone="warn" className="diff-notice" />'],
  },
  {
    name: 'バッジは Badge を通す',
    fix: 'Badge を使う（色は tone、小さいバッジは small）',
    /** 色の組み合わせ（tone）を部品の側でそろえ、コントラストの検査をした組み合わせだけを使うため */
    pattern: /['"`](?:[\w-]+\s+)*badge(?=[\s'"`-])/,
    appliesTo: (file) => file.endsWith('.tsx'),
    allowed: { '/src/components/Badge.tsx': '共通の部品そのもの' },
    detects: ['<span className="badge">{n} 件</span>', "<span className={ok ? 'badge badge-good' : 'badge badge-bad'} />", '<span className="badge-small">重要</span>', '<span className="mono badge">{alg}</span>'],
    ignores: ['<Badge tone="good">有効</Badge>', '<span className="status-badge" />', "import { Badge } from '../../components/Badge';"],
  },
  {
    name: '見出し付きの入力・出力の欄は Pane を通す',
    fix: 'Pane を使う（見出しは title、操作は actions）',
    /** 見出しと操作の並び（.pane-head・.pane-actions）と、欄の中の余白（gap）を画面ごとに書き分けないため */
    pattern: /['"`](?:[\w-]+\s+)*pane(?:-head)?(?=[\s'"`])/,
    appliesTo: (file) => file.endsWith('.tsx'),
    allowed: {
      '/src/components/Pane.tsx': '共通の部品そのもの',
      '/src/components/FormattedOutput.tsx': '見出しのない Pane の中に置く、整形結果の見出し（コピー・全文の保存の操作）',
    },
    detects: ['<div className="pane"><div className="pane-head">入力</div></div>', '<span className="pane-head">置換文字列</span>', '<div className="stack pane">{children}</div>'],
    ignores: ['<Pane title="入力" actions={<CopyButton text={text} />}>{children}</Pane>', '<span className="muted pane-sub">{summary}</span>', '<div className="panel" />'],
  },
  {
    name: '例外の文言は errorMessage で取り出す',
    fix: 'errorMessage を使う（描画中の計算は attempt）',
    /** `(e as Error).message` は Error 以外が投げられると undefined になり、ErrorText に渡すと描画中に例外になる */
    pattern: /\bas Error\)\.message\b|instanceof Error\s*\?/,
    allowed: { '/src/lib/errors.ts': '共通の処理そのもの' },
    detects: ['setError((e as Error).message);', 'const m = e instanceof Error ? e.message : String(e);'],
    ignores: ['setError(errorMessage(e));', 'if (e instanceof Error) throw e;'],
  },
  {
    name: '画面の非同期の結果は useAsyncFor で入力と組にして持つ',
    fix: 'useAsyncFor を使う（途中経過は report、打ち切りは isCancelled、入力を待つ時間は delay）',
    /** 結果を入力と組にせずに持つと、入力を変えた直後の描画で前の入力の結果（「署名は正しい」など）を表示してしまうため */
    pattern: /\blet\s+cancelled\b/,
    allowed: {
      '/src/hooks/useAsyncFor.ts': '共通の処理そのもの',
    },
    detects: ['useEffect(() => { let cancelled = false; return () => { cancelled = true; }; }, [key]);'],
    ignores: ['const result = useAsyncFor(key, run, onError);', 'const cancelledCount = 0;'],
  },
  {
    name: 'Worker の計算は useWorkerJob を通す',
    fix: 'useWorkerJob を使う（大容量計算は useCalculation）',
    /** 画面ごとに runWorker を呼ぶと、古い要求の結果を捨てる判定や、打ち切り・起動の失敗の文言が画面によって食い違うため */
    pattern: /\brunWorker\s*[<(]/,
    allowed: {
      '/src/lib/worker/runWorker.ts': '共通の処理そのもの',
      '/src/hooks/useWorkerJob.ts': '画面から Worker を使う入口',
    },
    detects: ['const job = runWorker({ request, create, delay: 150, timeout: 2000, onResult, onError });', 'runWorker<RegexInput, RegexResult>({ request })'],
    ignores: ['const job = useWorkerJob(request, OPTIONS);', "import { workerFailureMessage } from '../lib/runWorker';"],
  },
  {
    name: 'テキストの行の分割は src/lib/text/lines.ts を通す',
    fix: 'src/lib/text/lines.ts の splitLines を使う',
    /** 処理ごとに書くと、CR だけの改行や混在した改行の扱いと行番号が処理によって食い違うため */
    pattern: /\.split\(\s*(?:\/[^/\n]*\\[rn]|(['"`])(?:\\r\\n|\\r|\\n)\1)/,
    detects: ['text.split(/\\r?\\n/)', "text.split('\\n')", 'text.split(/\\r\\n|\\r|\\n/, 10)', "text.split('\\r\\n')", 'text.split(`\\n`)'],
    ignores: ['splitLines(text)', 'body.split(LINE_BREAK)', 'line.split(/\\s+/)', "line.split(',')"],
  },
  {
    name: 'ツールの画面の長い出力は TextOutputPreview・ClippedText で表示する',
    fix: 'TextOutputPreview（長い出力）・ClippedText（長い1つの値）を使う',
    /** 画面ごとに切り詰めると、案内の文言・位置や全文のコピーの有無が画面によって食い違うため */
    pattern: /\btextPreview\s*\(/,
    appliesTo: (file) => file.startsWith('/src/tools/') && file.endsWith('.tsx'),
    allowed: { '/src/tools/text-diff/index.tsx': '差分の行は、変更箇所の強調（行の中の区間）と合わせて切り詰めるため' },
    detects: ['<pre>{textPreview(text, TEXT_PREVIEW_LIMIT)}</pre>', '<textarea value={textPreview (output, TEXT_PREVIEW_LIMIT)} />'],
    ignores: ['<TextOutputPreview label="出力" text={output} />', '<ClippedText text={value} />', 'const preview = result.textPreviewLimit;'],
  },
  {
    name: 'ファイルの読み込みと上限超過の文言は src/lib/file.ts の共通の処理を通す',
    fix: 'src/lib/file.ts の readFileWithin・fileTooLargeMessage を使う',
    /** ツールごとに書くと、上限の単位（MB・MiB）や、読めなかったときの文言がそろわなくなるため */
    pattern: /\.arrayBuffer\s*\(|ファイルが大きすぎます/,
    allowed: { '/src/lib/file.ts': '共通の処理そのもの' },
    detects: ['const bytes = new Uint8Array(await file.arrayBuffer());', "setError('ファイルが大きすぎます（上限24MB）');"],
    ignores: ['const bytes = await readFileWithin(file, MAX_FILE);', 'setError(fileTooLargeMessage(MAX_FILE));'],
  },
  {
    name: 'ツールのファイルの読み込みは useFileLoader で、最後に選んだファイルだけを反映する',
    fix: 'useFileLoader を使う',
    /** ツールごとに書くと、前に選んだファイルの遅い読み込みが後の入力を上書きしたり、上限超過・失敗の文言がそろわなくなったりするため */
    pattern: /\b(?:readFileWithin|useLatestRead)\s*\(/,
    appliesTo: (file) => file.startsWith('/src/tools/'),
    allowed: {
      '/src/tools/hash/computeHashes.ts': '選んだ時点では読まず、useAsyncFor が呼ぶ全アルゴリズムの計算の中で読む。古い結果は key で捨てる。画面から計算を分離したので例外も定義元へ移す',
    },
    detects: ['const bytes = await readFileWithin(file, MAX_FILE);', 'const read = useLatestRead();'],
    ignores: ['const loader = useFileLoader({ limit: MAX_FILE, decode, onLoaded });', 'void loader.pick(file);'],
  },
  {
    name: 'IME の変換中のキーは isImeComposing で判定する',
    fix: 'src/lib/keyboard.ts の isImeComposing を使う',
    /** 画面ごとに書くと、Safari 向けの keyCode 229 の判定が漏れ、変換を確定する Enter で追加・移動などが起きるため */
    pattern: /\bkeyCode\s*[!=]==?\s*229\b|\.nativeEvent\.isComposing\b/,
    allowed: { '/src/lib/keyboard.ts': '共通の処理そのもの' },
    detects: ['const skip = e.nativeEvent.isComposing;', 'const skip = e.isComposing || e.keyCode === 229;', "if (e.key === 'Enter' && e.keyCode !== 229) add();"],
    ignores: ['const skip = isImeComposing(e);', "const skip = event.inputType === 'historyUndo' && event.isComposing;", 'const code = e.keyCode === 2290;'],
  },
  {
    name: '日本時間は JST_ZONE・formatJst で扱う',
    fix: 'JST_ZONE・formatJst・formatJstLabeled を使う',
    /** ツールごとに書くと、既定のタイムゾーンや「〜 JST」の付け方が画面によって食い違うため */
    pattern: /['"`]Asia\/Tokyo['"`]/,
    allowed: { '/src/lib/time/timezone.ts': '共通の処理そのもの（JST_ZONE の定義）' },
    detects: ["formatInZone(date, 'Asia/Tokyo')", 'const JST = "Asia/Tokyo";', 'usePreference<Zone>(key, `Asia/Tokyo`, isStoredZone);'],
    ignores: ['formatJst(date)', 'usePreference<Zone>(key, JST_ZONE, isStoredZone);', "const description = 'タイムゾーンは Asia/Tokyo のように書きます';", "const zone = 'Asia/Shanghai';"],
  },
  {
    name: '数の3桁区切りは formatNumber で書く',
    fix: 'src/lib/number.ts の formatNumber を使う',
    /**
     * ロケールを省いた toLocaleString() はブラウザの言語設定に従い、ドイツ語なら「1.000」になって小数と紛らわしいため。
     * 'ja-JP' を書いた呼び出しも、書式を1か所で決めるため formatNumber に寄せる。日付の toLocaleDateString などは対象外
     */
    pattern: /\.toLocaleString\s*\(/,
    allowed: { '/src/lib/number.ts': '共通の処理そのもの' },
    detects: ['const s = n.toLocaleString();', "const s = text.length.toLocaleString('ja-JP');", '<Stat value={r.lines.toLocaleString()} />'],
    ignores: ['const s = formatNumber(n);', "const d = date.toLocaleDateString('ja-JP');", "const t = date.toLocaleTimeString('ja-JP');"],
  },
  {
    name: '日時を、ブラウザのタイムゾーン（現地時刻）で読み書きしない',
    fix: 'src/lib/time/ の処理（wallOf・zonedToUtc・formatInZone など、タイムゾーンを明示するもの）か、getUTC*・Date.UTC を使う',
    /**
     * 表示や計算は、日本時間か利用者が選んだタイムゾーンで行う。getHours などの現地時刻のメソッドは、利用者のブラウザの
     * タイムゾーンで結果が変わる。E2E はすべて日本時間（playwright.config.ts の timezoneId）で動くため、日本以外の環境での
     * 食い違いをテストでは見つけられない。そのため、書き方の段階で止める。
     * 複数の引数を渡す new Date(年, 月, …) も、現地時刻として読むため対象にする（new Date(Date.UTC(…)) は除く）
     */
    pattern: /\.(?:get|set)(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|Year)\s*\(|\.getTimezoneOffset\s*\(|\.toLocale(?:Date|Time)String\s*\(|\bnew Date\((?!\s*Date\.UTC\b)(?:[^(),]|\([^()]*\))*,/,
    detects: [
      'const h = date.getHours();',
      'd.setDate(d.getDate() + 1);',
      'const offset = new Date().getTimezoneOffset();',
      "const s = date.toLocaleDateString('ja-JP');",
      'const d = new Date(2026, 0, 1);',
      'const d = new Date(Number(y), m - 1, 1);',
    ],
    ignores: [
      'const h = date.getUTCHours();',
      'const d = new Date(Date.UTC(2026, 0, 1));',
      'const d = new Date(ms);',
      'const d = new Date(Number(ms));',
      'const { y, mo, d } = wallOf(ms, zone);',
      'const [date, setDate] = useState(today);',
    ],
  },
  {
    name: '再 export をしない（関数は定義したファイルから直接読み込む）',
    fix: '使う側で、関数を定義したファイルから直接読み込む',
    /**
     * どのファイルに定義があるかを import から分かるようにするため（ARCHITECTURE.md の「コードの配置」）。
     * 例外は保存領域の入口だけで、ロックと消去世代の決まりを迂回させないよう、フォルダの外へは入口から公開する
     */
    pattern: /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]/,
    allowed: { '/src/lib/storage/index.ts': '保存領域の入口（フォルダの外からは、このファイルだけを読み込む）' },
    detects: ["export { parseEpoch } from './epoch';", "export { type BulkMode, parseAny } from './epoch';", "export type { Zone } from '../lib/timezone';", "export * from './epoch';", "export * as epoch from './epoch';"],
    ignores: ["import { parseEpoch } from './epoch';", 'export { parseEpoch };', 'export const from = 1;', "export function parse(text: string) { return text; }"],
  },
  {
    name: 'ツールの画面の入力欄は LargeTextInput を使い、普通の textarea は上限の小さい欄だけ',
    fix: 'LargeTextInput にする（例外は、貼り付けられる量そのものが小さい欄だけ）',
    /**
     * 普通の textarea に長いテキストを入れると、描画だけで画面が止まる（90万単位で約1〜2秒、改行のない長い1行では数十秒）。
     * 読み取り専用の出力欄は、表示を先頭までにしてから渡すので対象外。例外に足すのは、maxLength などで貼り付けられる量そのものが
     * 小さいと決まっている欄だけ（読み込むときの検査の上限は、欄に入る量を制限しないため、例外の理由にならない）
     */
    pattern: /<textarea\b(?:=>|[^>])*>/,
    appliesTo: (file) => file.startsWith('/src/tools/') && file.endsWith('.tsx'),
    label: (tag) => (/\breadOnly\b/.test(tag) ? null : /aria-label="([^"]*)"/.exec(tag)?.[1] ?? '（名前なし）'),
    detects: ['<textarea aria-label="入力" value={text} onChange={onChange} />', '<textarea value={text} />'],
    ignores: ['<LargeTextInput label="入力" value={text} onChange={setText} />', '<textarea readOnly aria-label="出力" value={preview} />', '<textarea onFocus={(e) => e.target.select()} readOnly aria-label="出力" value={preview} />'],
  },
];

/** import の読み込む側と読み込まれる側（拡張子を除いた、/src から始まるパス） */
export type ImportEdge = { file: string; target: string };

export type ImportRule = {
  /** 規則の名前（テストの名前になる） */
  name: string;
  /** 直し方（検査が失敗したときに表示する） */
  fix: string;
  /** 読み込む側と読み込まれる側の組が、規則に反するか */
  forbids: (edge: ImportEdge) => boolean;
  /** 規則の例外にする「読み込む側 → 読み込まれる側」と、その理由。使わなくなった例外は検査で失敗する */
  allowed?: Record<string, string>;
  /** 検出すべき組の例 */
  detects: ImportEdge[];
  /** 検出してはいけない組の例 */
  ignores: ImportEdge[];
};

/**
 * import のパスから、末尾の拡張子（.ts・.tsx・.js など）を外す。
 * moduleResolution が bundler のため、`.ts` と書いても `.js` と書いても同じ TypeScript のファイルを読める。
 * 拡張子の有無や種類で規則を通り抜けないよう、パスで判定する規則はこれを通す
 */
const withoutExtension = (target: string) => target.replace(/\.[cm]?[jt]sx?$/, '');

const toolOf = (path: string) => /^\/src\/tools\/([^/]+)\//.exec(path)?.[1];

/** 計算の振り分け。ツールの計算処理をまとめて読み込むため、Worker の入口とテストだけが読み込む */
const CALCULATION_HANDLERS = '/src/calculation/handlers';

/** 保存領域のフォルダ。外からは入口（index.ts）だけを読み込む */
const STORAGE_DIR = '/src/lib/storage/';
const STORAGE_ENTRY = new Set(['/src/lib/storage', '/src/lib/storage/index']);

export const IMPORT_RULES: ImportRule[] = [
  {
    name: 'ツール同士の import は、許可したものだけ',
    fix: '共通の処理を src/lib/ に移す。どうしても必要なら、allowed と ARCHITECTURE.md の「ツール間の依存」に理由と一緒に足す',
    /** ツール同士の依存を増やさず、共通の処理は src/lib に置く。許可に足すときは、lib へ移せないか先に検討する */
    forbids: ({ file, target }) => {
      const from = toolOf(file);
      const to = toolOf(target);
      return from !== undefined && to !== undefined && from !== to;
    },
    allowed: {},
    detects: [{ file: '/src/tools/jwt-decoder/keys.ts', target: '/src/tools/cert/logic' }],
    ignores: [
      { file: '/src/tools/cert/index.tsx', target: '/src/tools/cert/logic' },
      { file: '/src/tools/cert/logic.ts', target: '/src/lib/crypto/asn1' },
    ],
  },
  {
    name: 'lib はツールも、ツールをまとめて読み込む src/calculation/ も読み込まない',
    fix: '共通の処理をツールから src/lib/ に移す。計算 Worker の振り分け・入口・起動は src/calculation/ に置き、lib からは読み込まない',
    /**
     * 共通の処理がツールに依存すると、ツール間の依存を lib 経由で作れてしまうため。
     * src/calculation/ は全ツールの計算処理を読み込む（Worker のコードを ?worker-source で読み込む起動処理も、その先で全ツールを含む）ため、
     * lib から読み込むと、直接の import がなくても lib がツールに依存する
     */
    forbids: ({ file, target }) => file.startsWith('/src/lib/') && (target.startsWith('/src/tools/') || target.startsWith('/src/calculation/')),
    detects: [
      { file: '/src/lib/time/date.ts', target: '/src/tools/cron/parse' },
      { file: '/src/lib/worker/calculationLimits.ts', target: '/src/tools/csv-json/logic' },
      /** `import source from '../../calculation/worker?worker-source'` は、問い合わせ（?worker-source）を除いたパスになる */
      { file: '/src/lib/worker/createTrustedWorker.ts', target: '/src/calculation/worker' },
    ],
    ignores: [
      { file: '/src/calculation/handlers.ts', target: '/src/tools/csv-json/calculation' },
      { file: '/src/lib/time/date.ts', target: '/src/lib/time/civilTime' },
    ],
  },
  {
    name: 'ツールを読み込んでよいのは、src/tools/ の中と、計算 Worker（src/calculation/）だけ',
    fix: '共通で使う処理は src/lib/ に、共通の部品は src/components/ に移す。画面の一覧は src/registry.ts の遅延読み込み（import.meta.glob）で読み込む',
    /**
     * 共通の部品・フックがツールに依存すると、ツールを1つ消したり変えたりしたときに、ほかのツールの画面まで壊れるため（docs/ARCHITECTURE.md の配置の表）。
     * src/registry.ts は import.meta.glob でツールの画面を遅延読み込みするが、glob はこの検査（静的な import）の対象外
     */
    forbids: ({ file, target }) => target.startsWith('/src/tools/') && !file.startsWith('/src/tools/') && !file.startsWith('/src/calculation/'),
    detects: [
      { file: '/src/hooks/useCalculation.ts', target: '/src/tools/csv-json/logic' },
      { file: '/src/components/KvRow.tsx', target: '/src/tools/cert/logic.ts' },
      { file: '/src/app/ToolPage.tsx', target: '/src/tools/json-formatter/index' },
    ],
    ignores: [
      { file: '/src/tools/cert/index.tsx', target: '/src/tools/cert/logic' },
      { file: '/src/calculation/handlers.ts', target: '/src/tools/csv-json/calculation' },
      { file: '/src/hooks/useCalculation.ts', target: '/src/calculation/protocol' },
    ],
  },
  {
    name: '計算の振り分け（src/calculation/handlers.ts）は、計算 Worker の入口だけが読み込む',
    fix: '画面・フックからは src/calculation/protocol.ts の型と src/lib/worker/calculationLimits.ts の上限だけを使い、計算は useCalculation で Worker に任せる',
    /** 振り分けは全ツールの計算処理を読み込むため、画面から読み込むと、計算処理が最初に読み込むファイルに入り、Worker で計算する意味もなくなる */
    forbids: ({ file, target }) => withoutExtension(target) === CALCULATION_HANDLERS && file !== '/src/calculation/worker.ts',
    detects: [
      { file: '/src/hooks/useCalculation.ts', target: '/src/calculation/handlers' },
      { file: '/src/tools/text-diff/index.tsx', target: '/src/calculation/handlers.ts' },
      { file: '/src/tools/text-diff/index.tsx', target: '/src/calculation/handlers.js' },
    ],
    ignores: [
      { file: '/src/calculation/worker.ts', target: '/src/calculation/handlers' },
      { file: '/src/hooks/useCalculation.ts', target: '/src/calculation/protocol' },
    ],
  },
  {
    name: '保存領域は、フォルダの外からは入口（src/lib/storage/index.ts）だけを読み込む',
    fix: '入口（src/lib/storage/index.ts）の操作を使う（足りなければ、ロックの決まりを守った操作を入口に足す）',
    /** io.ts の clearAppData などはロックも消去世代の記録もしないため、画面やフックから直接呼ぶと全消去や別タブの保存と競合する */
    forbids: ({ file, target }) => !file.startsWith(STORAGE_DIR) && target.startsWith(STORAGE_DIR) && !STORAGE_ENTRY.has(withoutExtension(target)),
    detects: [
      { file: '/src/hooks/useInput.ts', target: '/src/lib/storage/io' },
      { file: '/src/components/InputSaveNotice.tsx', target: '/src/lib/storage/inputSaveFailures' },
    ],
    ignores: [
      { file: '/src/hooks/useInput.ts', target: '/src/lib/storage' },
      { file: '/src/main.tsx', target: '/src/lib/storage/index' },
      { file: '/src/main.tsx', target: '/src/lib/storage/index.ts' },
      { file: '/src/main.tsx', target: '/src/lib/storage/index.js' },
      { file: '/src/lib/storage/index.ts', target: '/src/lib/storage/clear' },
      { file: '/src/lib/storage/preferences.ts', target: '/src/lib/settings' },
    ],
  },
  {
    name: 'アプリのソースは、テストからだけ読むファイル（*.fixtures.ts・*.testing.ts）を読み込まない',
    fix: 'アプリで使うなら名前を変えてアプリのソースにする（秘密鍵の見本などを本番に入れないよう、中身を確かめる）',
    /** テスト用のデータ（秘密鍵・トークンの見本など）や検査の補助を、本番のビルドに入れないため。テストのファイルはこの検査の対象外 */
    forbids: ({ target }) => /\.(?:fixtures|testing)$/.test(withoutExtension(target)),
    detects: [
      { file: '/src/tools/jwt-decoder/index.tsx', target: '/src/tools/jwt-decoder/tokens.fixtures' },
      { file: '/src/lib/text/lines.ts', target: '/src/sourceScan.testing' },
      /** 拡張子付きの import（`./tokens.fixtures.ts`・`./tokens.fixtures.js`）も止める */
      { file: '/src/tools/jwt-decoder/index.tsx', target: '/src/tools/jwt-decoder/tokens.fixtures.ts' },
      { file: '/src/tools/jwt-decoder/index.tsx', target: '/src/tools/jwt-decoder/tokens.fixtures.js' },
    ],
    ignores: [
      { file: '/src/tools/jwt-decoder/index.tsx', target: '/src/tools/jwt-decoder/tokens' },
      { file: '/src/tools/cert/index.tsx', target: '/src/tools/cert/fixturesView' },
    ],
  },
];
