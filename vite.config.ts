import { defineConfig } from 'vitest/config';
import { build, type Plugin, type Rolldown } from 'vite';
import react from '@vitejs/plugin-react';
/** Viteの設定読み込みに対応するため、ローカルのTypeScriptには拡張子を付ける。 */
import { CSP } from './csp.config.ts';
import packageJson from './package.json' with { type: 'json' };
import { thirdPartyLicenseText } from './scripts/third-party-licenses.mjs';

/**
 * 画面に表示する版（src/buildInfo.ts）。package.json の version と、ビルドしたコミット（GitHub Actions の GITHUB_SHA の先頭7文字）。
 * 手元のビルドは「local」にする。ビルドの日時は入れない（同じコミットからは同じ成果物を作り、成果物のハッシュで比べられるようにするため）。
 * Node の型定義を依存に足さないため、process は globalThis から読む
 */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const BUILD_COMMIT = /^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ? (env.GITHUB_SHA ?? '').slice(0, 7) : 'local';

/**
 * 本番ビルドの index.html の先頭に CSP を埋め込む。
 * 開発サーバー（npm run dev）では入れない：connect-src 'none' だと Vite の自動再読み込み（WebSocket）が止まるため。
 */
function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
      };
    },
  };
}

const WORKER_SOURCE = '?worker-source';

/** Worker のバンドルに入ったモジュール。Worker のコードは文字列として本体に埋め込むため、本体のバンドルの一覧には現れない（thirdPartyLicenses で使う） */
const workerModuleIds = new Set<string>();

/**
 * `import source from './worker?worker-source'` で、Worker のコードを1つにまとめた文字列を返す。
 * URL から読み込んだ Worker には、<meta> の CSP が適用されない（応答ヘッダの CSP だけが使われ、GitHub Pages では付けられない）。
 * blob: の URL の Worker は作ったページの CSP を引き継ぐため、src/lib/worker/createTrustedWorker.ts でこの文字列から blob: の URL を作る。
 * Vite の ?worker&inline は文字列の URL で Worker を起動し、失敗すると data: の URL を使うため、Trusted Types と合わず使わない。
 */
function workerSource(): Plugin {
  return {
    name: 'worker-source',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith(WORKER_SOURCE)) return;
      const entry = id.slice(0, -WORKER_SOURCE.length);
      const output = (await build({
        configFile: false,
        logLevel: 'warn',
        build: {
          write: false,
          emptyOutDir: false,
          copyPublicDir: false,
          modulePreload: false,
          sourcemap: false,
          rolldownOptions: { input: entry, output: { codeSplitting: false } },
        },
      })) as Rolldown.RolldownOutput | Rolldown.RolldownOutput[];
      const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output);
      const chunk = chunks.find((c): c is Rolldown.OutputChunk => c.type === 'chunk' && c.isEntry);
      if (!chunk || chunks.length !== 1) throw new Error(`Worker を1つのファイルにまとめられません：${entry}`);
      for (const file of chunk.moduleIds) {
        this.addWatchFile(file);
        workerModuleIds.add(file);
      }
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}

/**
 * 配布物に含まれる第三者のパッケージ（React など）のライセンスを、dist/THIRD_PARTY_LICENSES.txt に書き出す。
 * 圧縮でライセンスのコメントが消え、MIT ライセンスが求める著作権表示が配布物に残らないため。
 * 本文の作り方は scripts/third-party-licenses.mjs。依存パッケージを増やさないよう、ライセンスを集めるプラグインは使わない
 */
function thirdPartyLicenses(): Plugin {
  let root = '';
  return {
    name: 'third-party-licenses',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((item) => (item.type === 'chunk' ? item.moduleIds : []));
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: thirdPartyLicenseText([...ids, ...workerModuleIds], root) });
    },
  };
}

/**
 * base: './' にしておくと、リポジトリ名に関係なく
 * https://<user>.github.io/<repo>/ でそのまま動きます（HashRouter と組み合わせて使用）
 */
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_COMMIT__: JSON.stringify(BUILD_COMMIT),
  },
  plugins: [workerSource(), react(), cspMeta(), thirdPartyLicenses()],
  build: {
    /** ソースマップは公開しない（ソースは GitHub で公開済みだが、ビルド成果物を小さく保つ） */
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /** 入口と分割先のCSSを読み、実際に配信する色をコントラスト検査の対象にする。 */
    css: { include: [/\.css(?:\?|$)/] },
    /**
     * 変換結果をファイルに残すキャッシュは、テストのファイルの内容が同じなら前回の結果を使う。
     * import.meta.glob で集めるソースの一覧（静的検査・文書の検査）も前回のままになり、新しく足したファイルを検査しないため使わない
     */
    fsModuleCache: false,
  },
});
