/**
 * Content Security Policy（CSP）。
 *
 * GitHub Pages では HTTP レスポンスヘッダを設定できないため、本番ビルドの index.html に
 * <meta http-equiv="Content-Security-Policy"> として埋め込む（vite.config.ts）。
 *
 * このアプリは外部と通信しないので、fetch・WebSocket などの通信と外部リソースの読み込みを禁止している。
 * ただし、ページの移動や WebRTC は <meta> の CSP では防げない。XSS や依存ライブラリへの悪意あるコード混入で
 * ページ上のコードが動けば、入力内容が外へ出る可能性はある（SECURITY.md の「既知の制約」）。
 *
 * Trusted Types（require-trusted-types-for / trusted-types）で、innerHTML などへ文字列を代入する処理を
 * ブラウザに拒否させる。React で文字列を表示する限り使われないため、dangerouslySetInnerHTML などで
 * 入力内容が HTML として挿入される（偽のリンクやフォームの表示など）のを防ぐ。
 * 例外は、計算を中断できるよう Worker を起動するためのポリシー（TRUSTED_TYPES_POLICIES）だけ。
 * Worker の起動にも TrustedScriptURL が必要なためで、src/lib/worker/createTrustedWorker.ts で、ビルドに含まれる
 * Worker のコードから作った blob: の URL だけを完全一致で許可する。ほかのコードに名前を先に使われないよう、
 * ポリシーは起動時にまとめて作る（src/trustedTypes.ts）。HTML・スクリプト本文のポリシーは作らず、入力や任意の URL は許可しない。
 *
 * Worker は blob: の URL からだけ起動できる（worker-src blob:）。URL から読み込んだ Worker には
 * <meta> の CSP が適用されないが、blob: の Worker はこのページの CSP を引き継ぐため、Worker の中でも通信を禁止できる。
 * 同じオリジンのファイル（同じ組織のほかの Pages サイトのものを含む）を Worker として起動することもできない。
 * 通信元・スクリプト元の許可は増やさない。
 * Trusted Types に対応していないブラウザでは、この2つの指定だけが無視され、ほかの指定はそのまま有効。
 *
 * 指定の一覧は src/csp.test.ts で完全一致を確かめる。緩める変更（許可の追加）は、そのテストの期待値も変えることになるため、
 * レビューで必ず目に入る。Web アプリマニフェストは置いていないため、manifest-src も default-src 'none' のまま閉じる。
 *
 * 注意：meta タグでは frame-ancestors（クリックジャッキング対策）と report-uri は効かない。
 * クリックジャッキングは、埋め込まれたときにアプリを表示しないことで防いでいる（src/main.tsx）。
 */
/** 許可する Trusted Types のポリシーの名前。Worker を起動する処理も、この名前を使う */
export const TRUSTED_TYPES_POLICIES = {
  /** 正規表現テスター（src/tools/regex/createWorker.ts） */
  regexWorker: 'dev-toolbox-regex-worker',
  /** 大容量の計算（src/calculation/createWorker.ts）。使うツールは src/calculation/protocol.ts の CalculationRequest にある */
  calculationWorker: 'dev-toolbox-calculation-worker',
} as const;

export const CSP_DIRECTIVES: Record<string, string> = {
  'default-src': "'none'",
  'script-src': "'self'",
  'style-src': "'self'",
  'img-src': "'self'",
  'font-src': "'self'",
  'connect-src': "'none'",
  'worker-src': 'blob:',
  'base-uri': "'none'",
  'form-action': "'none'",
  'object-src': "'none'",
  'require-trusted-types-for': "'script'",
  'trusted-types': Object.values(TRUSTED_TYPES_POLICIES).join(' '),
};

export const CSP = Object.entries(CSP_DIRECTIVES)
  .map(([k, v]) => `${k} ${v}`)
  .join('; ');
