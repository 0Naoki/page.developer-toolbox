/**
 * ツールの一覧（画面を含まないメタデータ）。
 *
 * @remarks
 * React に依存しないため、保存の処理（src/lib/storage/）・単体テスト・E2E・計測スクリプトからも読める。
 * 画面（遅延読み込みの部品）は src/registry.ts が `folder` から付ける。ツールを足すときは、ここに1件足す。
 */

export const CATEGORIES = ['変換・整形', 'テキスト', '日付・時刻', 'ネットワーク', '生成・セキュリティ'] as const;
export type Category = (typeof CATEGORIES)[number];

export type ToolMeta = {
  /**
   * ツールの ID。URL のパス（#/json など）、入力の保存キー（`input:<ID>:…`）、表示設定のキー（`<ID>:…`）の先頭に使う。
   * 変えると、ブックマークと保存済みのデータが読めなくなる
   */
  readonly id: string;
  /** ツールのフォルダ名（`src/tools/<folder>/`）。ツール別の CSS の名前（`src/styles/<folder>.css`）にも使う。ID とは別のもの */
  readonly folder: string;
  readonly name: string;
  readonly description: string;
  readonly category: Category;
  /** コマンドパレットの検索対象になるキーワード */
  readonly tags: readonly string[];
  /**
   * 入力欄の内容をこのタブ（sessionStorage）に保存するか（useInput を使えるか）。
   * トークン・鍵・生成したパスワードなど、機密になり得る値を扱うツールは false にする
   */
  readonly savesInput: boolean;
};

/** 要素の型を ToolMeta に広げずに残し、一覧から {@link ToolId} と、入力を保存するツールの ID を作る */
const defineTools = <const T extends readonly ToolMeta[]>(list: T) => list;

/** ツールの一覧。この順にサイドバー・トップページ・コマンドパレットに並ぶ */
export const toolCatalog = defineTools([

  /** 変換・整形 */
  {
    id: 'json',
    folder: 'json-formatter',
    name: 'JSON整形',
    description: '整形・圧縮・キーのソート、構文エラー位置の表示',
    category: '変換・整形',
    tags: ['json', 'format', 'minify', '整形', '圧縮'],
    savesInput: true,
  },
  {
    id: 'csv',
    folder: 'csv-json',
    name: 'CSV ⇔ JSON',
    description: 'CSV と JSON の相互変換。先頭0の値を保持、入れ子の展開、Excel向けBOM付き保存',
    category: '変換・整形',
    tags: ['csv', 'tsv', 'json', 'excel', '変換'],
    savesInput: true,
  },
  {
    id: 'base64',
    folder: 'base64',
    name: 'Base64 / URLエンコード',
    description: 'Base64・Base64URL・URLエンコードの相互変換（日本語対応）、ファイルや data: URI、16進ダンプ',
    category: '変換・整形',
    tags: ['base64', 'url', 'encode', 'decode', 'data uri', 'hex', 'エンコード', 'デコード', 'バイナリ'],
    savesInput: true,
  },
  {
    id: 'radix',
    folder: 'radix',
    name: '進数変換・ビット演算',
    description: '2・8・10・16進数の相互変換、2の補数とバイト順、ビット演算、浮動小数点の内部表現',
    category: '変換・整形',
    tags: ['radix', 'hex', 'binary', 'bit', 'float', '進数', '2進数', '16進数', 'ビット', '補数', '浮動小数点'],
    savesInput: true,
  },
  /** テキスト */
  {
    id: 'regex',
    folder: 'regex',
    name: '正規表現テスター',
    description: 'リアルタイムのマッチ強調、番号・名前付きキャプチャと位置の表示、置換プレビュー',
    category: 'テキスト',
    tags: ['regex', 'regexp', 'regular expression', '正規表現', 'マッチ', 'キャプチャ', '置換'],
    savesInput: true,
  },
  {
    id: 'diff',
    folder: 'text-diff',
    name: 'テキスト差分',
    description: '行単位・文字単位の差分を左右／統合表示。空白や大文字小文字の無視',
    category: 'テキスト',
    tags: ['diff', 'compare', '差分', '比較'],
    savesInput: true,
  },
  {
    id: 'count',
    folder: 'text-count',
    name: '文字数・バイト数',
    description: '文字数・各文字コードのバイト数、不可視文字と改行コードの検査、機種依存文字の検出、行ごとの桁あふれチェック',
    category: 'テキスト',
    tags: ['count', 'length', 'bytes', 'sjis', 'shift_jis', 'euc-jp', 'utf-16', '文字数', 'バイト', '桁数', '全角', '半角', '機種依存文字', '不可視文字', 'ゼロ幅', 'nbsp', 'bom', 'zwsp', '改行', 'crlf'],
    savesInput: true,
  },
  /** 日付・時刻 */
  {
    id: 'time',
    folder: 'unix-time',
    name: 'UNIX時間変換',
    description: 'エポック秒〜ナノ秒と日時の相互変換、任意のタイムゾーン、日時の差と期間の足し引き、ログの一括変換',
    category: '日付・時刻',
    tags: ['unix', 'epoch', 'timestamp', 'date', 'timezone', 'duration', '日時', 'タイムスタンプ', 'タイムゾーン', '時差', 'ログ'],
    savesInput: true,
  },
  {
    id: 'cron',
    folder: 'cron',
    name: 'cron式の解説',
    description: 'cron式の意味の解説と次回の実行日時（JST）。crontab・GitHub Actions・Quartz・EventBridge に対応',
    category: '日付・時刻',
    tags: ['cron', 'crontab', 'schedule', 'quartz', 'eventbridge', 'github actions', 'kubernetes', 'スケジュール', '定期実行', 'バッチ', 'ジョブ'],
    savesInput: true,
  },
  {
    id: 'wareki',
    folder: 'wareki',
    name: '和暦 ⇔ 西暦',
    description: '令和・平成・昭和などとの相互変換、改元日の判定、早見表、年齢',
    category: '日付・時刻',
    tags: ['wareki', 'era', '和暦', '西暦', '元号', '令和', '平成', '昭和', '年齢', '干支'],
    savesInput: true,
  },
  {
    id: 'bizdays',
    folder: 'business-days',
    name: '営業日計算',
    description: '祝日対応の営業日数、n営業日後、第n営業日・月末営業日、祝日一覧',
    category: '日付・時刻',
    tags: ['business', 'holiday', '営業日', '祝日', '休日', '稼働日'],
    savesInput: true,
  },
  /** ネットワーク */
  {
    id: 'subnet',
    folder: 'subnet',
    name: 'IPアドレス・サブネット計算',
    description: 'IPv4・IPv6 のサブネットの計算、アドレスの種別、含まれるかの判定、範囲の重複チェック、分割（VLSM）、集約',
    category: 'ネットワーク',
    tags: ['ip', 'ipv4', 'ipv6', 'subnet', 'prefix', 'cidr', 'netmask', 'vlsm', 'vpc', 'サブネット', 'ネットマスク', 'ネットワーク'],
    savesInput: true,
  },
  /** 生成・セキュリティ */
  {
    id: 'password',
    folder: 'password-generator',
    name: 'パスワード生成',
    description: '文字種・長さ・除外文字を指定して安全なパスワードやPINを生成',
    category: '生成・セキュリティ',
    tags: ['password', 'pin', 'random', 'generate', 'パスワード', '生成', '乱数'],
    savesInput: false,
  },
  {
    id: 'uuid',
    folder: 'uuid',
    name: 'UUID / ULID',
    description: 'UUID v4・v7、ULID の一括生成と、埋め込まれた時刻の解析',
    category: '生成・セキュリティ',
    tags: ['uuid', 'ulid', 'guid', 'id', '生成'],
    savesInput: false,
  },
  {
    id: 'hash',
    folder: 'hash',
    name: 'ハッシュ生成',
    description: 'MD5・SHA-1・SHA-256/384/512、HMAC、ファイルのハッシュと照合',
    category: '生成・セキュリティ',
    tags: ['hash', 'sha', 'sha256', 'md5', 'hmac', 'checksum', 'ハッシュ', 'チェックサム'],
    savesInput: false,
  },
  {
    id: 'jwt',
    folder: 'jwt-decoder',
    name: 'JWTデコーダー',
    description: 'ヘッダ・ペイロードの表示、期限切れ判定、署名の検証（HS・RS・PS・ES・EdDSA）、危険なヘッダの警告',
    category: '生成・セキュリティ',
    tags: ['jwt', 'jws', 'jwe', 'jwk', 'token', 'auth', 'verify', 'トークン', '認証', '署名', '検証'],
    savesInput: false,
  },
  {
    id: 'cert',
    folder: 'cert',
    name: '証明書デコーダー',
    description: 'SSL/TLS 証明書・CSR の有効期限、SAN、公開鍵、鍵の用途、フィンガープリント、チェーンのつながりと署名の検証',
    category: '生成・セキュリティ',
    tags: ['certificate', 'x509', 'pem', 'der', 'ssl', 'tls', 'csr', '証明書', '有効期限', 'san'],
    savesInput: false,
  },
]);

/** 一覧にあるツールの ID。保存キーの先頭もこの型で受け、ツールごとの略称を作らない */
export type ToolId = (typeof toolCatalog)[number]['id'];

/** 一覧にあるツールの ID か（保存した値など、外から来た文字列を ToolId として扱う前に確かめる） */
export const isToolId = (value: unknown): value is ToolId => typeof value === 'string' && toolCatalog.some((t) => t.id === value);
