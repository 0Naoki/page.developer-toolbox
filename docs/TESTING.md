# テストの実行と回帰防止

環境の準備と目視確認は [LOCAL_CHECK.md](LOCAL_CHECK.md)、実装時の必須ルールは [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。

## 実行コマンド

初回は `npm run setup` と `npm run e2e:install` で依存パッケージとブラウザを準備します（`npm run setup` は CI と同じ手順です）。

```bash
npm run check        # 型チェック・単体テスト・本番ビルド
npm run e2e:run      # 上で作ったビルドを全ブラウザで検査
```

E2Eだけ実行するときは `npm run e2e` でビルドから実行できます。`e2e:run` は既存の `dist` を使います。

`e2e:run` は、古いビルドを検査しないよう、ビルドの結果を変えるファイルが `dist` より新しければ、実行の前に止めて `npm run build` を案内します（`e2e/globalSetup.mjs`）。対象は `src`・`public`・`index.html`・`vite.config.ts`・`csp.config.ts`・`tsconfig.json`・`package.json`・`package-lock.json` で、テストからだけ使うファイルは除きます。CIは `check` の後にE2Eを実行し、ビルドを重複させません。

型チェック（`tsc --noEmit`）では、`tsconfig.json` の `noUncheckedIndexedAccess` で、配列やオブジェクトの添字で読んだ値を「ないかもしれない値」として検査します（テスト・E2E を含む）。アプリのコードでは、分割代入の既定値・`entries()`・`charAt` などで「ない場合」を扱い、既定値が実際には使われないときはその理由をコメントに書きます。添字が範囲内であることがアルゴリズムで決まる速度重視のループ（テキスト差分の Myers 法など）だけは、`?? 0` などの分岐を足さずに `!` で示し、理由をコメントに書いています。テストでは、値があることを確かめる位置で `!` や `?.` を使ってかまいません。

単体テストは、変換結果をファイルに残すキャッシュ（Vitest の `fsModuleCache`）を使いません。テストのファイルが同じなら `import.meta.glob` で集めるソースの一覧も前回のままになり、静的検査が新しく足したファイルを見逃すためです（`vite.config.ts`）。

単体テストはVitest、E2EはPlaywrightを使います。E2Eは本番ビルドを、GitHub Pagesと同じくサブパス（`/dev-toolbox/`）の配下で配信し、CSPを含めて検査します。パスの名前は公開先のリポジトリ名と異なりますが、`base: './'` のため結果は変わりません。コントラストの検査も単体テストに含まれます。

調査中は対象を絞れます。これらは全件検査の代わりではありません。

```bash
npm test -- src/tools/csv-json/logic.test.ts
npm run e2e:run -- --project=desktop
npm run e2e:run -- e2e/storage.spec.ts --project=webkit --workers=2
```

## ソースとドキュメントの検査

単体テスト（`npm test`）には、ソースとドキュメントを読んで確かめる検査も含まれます。E2E は実行した画面と分岐しか確かめられないため、決まりごとはここで機械的に確かめます。

画面（React の部品）を描画して確かめる単体テストはありません（依存パッケージを増やさない方針のため）。フックや画面の判定（今の入力に対する結果かどうかなど）は、`acceptResponse` や `linesPage` のような純粋関数に切り出して単体テストで確かめ、操作の流れは E2E で確かめます。

| ファイル | 確かめること | 失敗したときに直すところ |
|---|---|---|
| `src/architecture.test.ts` | アプリのソースが、下の「[静的検査の規則](#静的検査の規則)」を守っていること | 失敗したときに表示する直し方に従う（規則ごとの直し方は `src/sourceRules.testing.ts` の `fix`） |
| `src/sourceScan.test.ts` | 静的検査が使う解析（コメントの除去・通信の API の参照・ローカル依存の抽出）が、紛らわしい書き方を誤らないこと | `src/sourceScan.testing.ts` を直す |
| `src/docs.test.ts` | README の一覧・件数、入力保存対象と説明、ツールのファイルの分担、回帰テストの担当と先頭コメントがコードと一致すること | README・USAGE・TESTING や担当ファイルの説明を直す |
| `src/documentLinks.test.ts` | Markdown の相対リンク・見出しリンク、コード表記のファイルパス、コードのコメントや文言に書いたファイルのパスが存在すること（運用記録の過去のパスと書き方の例を除く） | リンク先・見出し・パスを直す |
| `src/styles.classes.test.ts` | CSS のクラスが、使う画面の範囲に合ったファイルにあること（ツール別の CSS のクラスをほかの画面で使わない。部品の層の CSS に1つの画面だけのクラスを置かない。ツール別の CSS のファイル名がツールのフォルダ名と同じ）。`src/styles/` のどのファイルも入口（`src/styles.css`）で1回だけ、見出しの番号に合った層（`layer(...)`）に入れて読み込むこと（読み込み忘れたファイルの規則は本番でまったく効かず、層に入れない規則はどの層よりも優先されるため）。クラスと画面の対応の読み方は `src/cssClasses.testing.ts` | クラスを、使う画面の範囲に合った CSS に移す（例外は、理由を書いてテストの `ALLOWED` に足す）。読み込みは `src/styles.css` の該当する層に足す |
| `src/scripts.test.ts` | 計測スクリプト（`scripts/*.mjs`）が、構文として正しく、読み込む先（Node の標準・`package.json` の依存・ほかのスクリプトの export）と、読み込むファイルのパス、比べる計算処理の関数・定数があること（スクリプトは型チェックの対象外で、計測のときにしか実行しないため） | スクリプトの import・パス・使う関数の名前を直す |
| `src/documentLimits.test.ts` | [USAGE.md](USAGE.md) の上限・表示量・打ち切りが実装の定数と一致し、クラウドの参照元と確認日が載っていること | USAGE の制約を、実装の定数と照合して直す |

文書の収集は `src/documentSources.testing.ts`、見出しアンカーと数値表記の照合は `src/documentMarkdown.testing.ts` に分けています。検査を移すときも検査項目を削らず、文書とコードの契約・リンク・上限の担当を保ちます。

### 静的検査の規則

コメントは構文解析（rolldown の `parseSync`）で除き、文字列の中の「//」などをコメントと誤らないようにしています。解析の処理は `src/sourceScan.testing.ts` にあります。

ローカル依存も構文木の import・再エクスポート・動的 import・型の import から抽出します。`src/sourceScan.test.ts` では、本物の参照を検出し、文字列・テンプレート・JSX の本文に書いた import の例を依存と誤認しないことを確認します。

パスとして読むのは文字列リテラルと、式を含まないテンプレートリテラルです。エスケープを解釈した文字列を使います。変数・文字列の連結・式を含むテンプレートは実行時の値を推測せず、依存の抽出対象外です。静的検査だけで任意の動的な読み込みを保証するものではありません。

規則は `src/sourceRules.testing.ts` にあり、規則ごとに名前・理由（コメント）・直し方（`fix`）・検出すべき書き方と見逃すべき書き方の例を持ちます。規則の一覧・理由・直し方はそのファイルだけに書き、この文書には書きません。検査が失敗すると、テストの名前（規則の名前）と直し方を表示します。

- 書き方の規則（`SOURCE_RULES`）：禁止している API（HTML の挿入・`eval`・`Math.random`・`?worker`・現地時刻の日時のメソッド）と、共通の処理（エラー・警告・バッジ・欄の表示、例外の文言、Worker、非同期の結果、行の分割、長い出力、ファイルの読み込み、IME、日本時間、数の書式、大きな入力欄）を通しているか、再 export をしていないか
- import の向きの規則（`IMPORT_RULES`）：ツール同士、`src/lib/` からツールと `src/calculation/`、計算の振り分け（`src/calculation/handlers.ts`）、保存領域の内部、テストからだけ読むファイル
- 外部と通信する API の参照（`fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・`sendBeacon`・`WebTransport`・WebRTC の `RTCPeerConnection` など。一覧は `NETWORK_NAMES`）：正規表現の規則ではなく、構文木から探す別の検査（`src/sourceScan.testing.ts` の `networkReferences`）で見つけます。変数に入れる・`window['fetch']`・``window[`fetch`]``・分割代入・`Reflect.get(window, 'fetch')` なども見つけられ、正規表現より検出の範囲が広いためです。名前を組み立てる書き方（`window['fe' + 'tch']`）は名前を追えないため、`window`・`globalThis`・`navigator` などへの動的なキーでの参照と、`Reflect.get` などへの受け渡しそのものを検出します。WebRTC は本番の CSP でも E2E の通信の監視でも止まらないため、この検査が唯一の歯止めです。同じ関心事の正規表現の規則は持ちません。直し方は `src/architecture.test.ts` にあります

規則の例外（許可したファイル・箇所・import の組）には理由を書き、使わなくなった例外は検査の失敗にします。規則を足すときは、直し方と、例を両方とも書いてください。

## E2E の書き方

Playwrightはケース単位で並列実行します。各ケースには独立したBrowserContextがあり、localStorage・時計・Workerの差し替えは他のケースと共有しません。CIは2並列、ローカルはCPU数の半分を使います。メモリやCPUが不足する場合は `--workers=2` または `--workers=1` に下げてください。テスト間でページや可変の状態を共有しないでください。

ChromiumのPC幅で全件を実行します。`CROSS_BROWSER` の付いたケースはFirefox・WebKitのPC幅でも実行します。Android・iPhoneの画面設定では、そのうち `smoke.spec.ts`・`mobile-navigation.spec.ts`・`navigation.spec.ts` のケースだけを実行します。保存・計算・暗号処理などはPCの3ブラウザで検査し、モバイルでは表示・メニュー・ナビゲーションを検査します。モバイル固有の入力・ダウンロード動作の検証範囲は縮小します。

ブラウザの起動自体が失敗した場合は、アプリの検査成功とは扱わず、未検証の環境として記録してください。失敗の記録は `npx playwright show-report` で確認できます。

CI で E2E が失敗したときは、同じレポートを成果物（`playwright-report`）として7日間残します（`.github/workflows/checks.yml`）。
ランナーのファイルはジョブの終了で消え、CI でだけ起きる失敗を調べられないためです。
取り出すときは、失敗した実行の **Actions** の画面の下にある **Artifacts** からダウンロードして展開し、`npx playwright show-report <展開したフォルダ>` で開きます。

通常のE2Eでは `e2e/fixtures.ts` の `test` を使います。ケースから使う補助は、関心事ごとに次のファイルにあります。1つのファイルのケースだけが使う補助は、そのケースのファイルに置きます。

| ファイル | 内容 |
|---|---|
| `e2e/watch.ts` | 外部への通信・CSP違反・実行時エラーの監視と、ブラウザごとの既知の報告の除外 |
| `e2e/app.ts` | メニュー・ツール検索・全消去の操作、ツールの一覧、描画の待ち合わせ |
| `e2e/paste.ts` | 貼り付けの再現（大容量の入力を含む） |
| `e2e/files.ts` | ファイルの選択と、保存したファイルの読み取り |
| `e2e/clipboard.ts` | コピーした内容の記録と読み取り |
| `e2e/tags.ts` | ブラウザ間で動かすケースの印 |

使い方の決まりは次のとおりです。

- ファイルを選ぶ操作は `e2e/files.ts` の `pickFile` で行います（中身はページの中で作るので、大きなファイルを手元に用意しません）。
- コピーした内容は `captureClipboard` で記録し、`copiedText`・`copiedLength`・`copiedLines` で確かめます（OS のクリップボードは変えません。長いテキストは長さや行数をページの中で数え、全文をテストへ渡しません）。
- 読み込みを遅らせる・失敗させるなど、特別なファイルを使うテストだけはページの中で直接作ります。
- ページを渡す前に外部通信・CSP違反・実行時エラーの監視を始め、終了時にまとめて検査するため、ケースごとの `watch` 呼び出しは不要です。
- CSPの拒否そのものを試すケースは標準の `test` を `probeTest` として明示し、期待する拒否をケース内で検証します。既存のopener・読込失敗を含む `security.spec.ts`・`navigation.spec.ts` は引き続き個別に検証します。

### 短縮するときのルール

- タイムアウトは `page.clock` で進め、実時間の2秒・10秒を待ちません。Workerの開始を確認してから時計を進め、終了後の再計算も検査します。
- 保存・描画の完了は状態を観測して待ちます。計算中に部品の位置が変わる場合は、計算完了を待って操作します。
- ファイル競合は読み込みの完了順序を明示して検査し、固定時間の待機に依存させません。
- テストを移動・統合するときは、分割前後のプロジェクト別のテスト名と件数を照合します。時間短縮のために既知不具合の入力や重要なアサーションを削らないでください。
- 通常実行はトレースを取らず、失敗したケースを1回だけ再実行して詳細なトレースを記録します。初回失敗時のスクリーンショットも残します。再実行で成功しても `failOnFlakyTests: true` により検査全体は失敗するため、再発や不安定さを隠しません。調査中に初回から記録したい場合は `--trace=on` を指定してください。
- セキュリティ検査の除外範囲を広げないでください。WebKitのselect内部スタイルに限った既存の除外は `e2e/watch.ts` にあります。

## 既知不具合を守るテスト

期待する動作は構成と設計方針の [非同期の結果](ARCHITECTURE.md#非同期の結果を表示できる条件) と [保存と全消去の調整](STORAGE.md#保存と全消去の調整) を参照してください。

表は、既知の不具合を守る検証の担当のファイルです。残すべき検証（不具合を起こした入力と、確かめること）は、担当のファイル（E2E があれば E2E、なければ最初に挙げたファイル）の先頭のコメントに書いています。テストを移動・統合するときは、そのコメントに挙げた入力とアサーションを削らずに引き継ぎ、コメントも移してください。下の「入力の境界と組み合わせ」の表も含め、どの行も担当のファイルの先頭のコメントに載っていることを `src/docs.test.ts` が確かめます。

### 画面全体と安全対策

| 検査対象 | ファイル |
|---|---|
| 全ツールの表示 | `e2e/smoke.spec.ts` |
| CSP・埋め込み | `e2e/browser-security.spec.ts`・`src/csp.test.ts` |
| 設定・opener | `e2e/security.spec.ts` |
| ナビゲーション | `e2e/navigation.spec.ts` |
| スマートフォンのメニュー | `e2e/mobile-navigation.spec.ts` |

### 保存

| 検査対象 | ファイル |
|---|---|
| 入力の保存と消去 | `e2e/storage.spec.ts` |
| 保存と全消去の競合 | `e2e/storage.spec.ts` |
| 入力を localStorage に保存しない | `src/lib/storage/index.test.ts` |
| 全消去の順序と遅れた通知 | `src/lib/storage/clear.test.ts` |
| 取りこぼした通知 | `src/lib/storage/clear.test.ts` |
| 離れていた間の全消去 | `e2e/storage.spec.ts`・`src/lib/storage/index.test.ts`・`src/lib/storage/clear.test.ts` |
| 表示設定の保存 | `e2e/security.spec.ts` |
| 古いキーの整理 | `src/lib/storage/index.test.ts`・`src/lib/storage/preferences.test.ts`・`src/registry.test.ts`・`e2e/storage.spec.ts` |
| 保存失敗・編集 | `e2e/edit-storage.spec.ts`・`src/lib/text/textEdit.test.ts` |

### 大容量の計算と表示

| 検査対象 | ファイル |
|---|---|
| 大容量計算 | `e2e/calculation.spec.ts` |
| テキスト差分の改行 | `src/tools/text-diff/logic.test.ts`・`e2e/calculation.spec.ts` |
| 行の分割 | `src/lib/text/lines.test.ts`・各ツールの `logic.test.ts` |
| 文字数・不可視文字 | `e2e/text-count.spec.ts` |

### ツール別

| 検査対象 | ファイル |
|---|---|
| CSVの読込・編集 | `e2e/csv-file-edit.spec.ts` |
| CSV変換 | `src/tools/csv-json/logic.test.ts`・`src/tools/csv-json/parseCsv.test.ts`・`src/tools/csv-json/writeCsv.test.ts`・`src/tools/csv-json/roundTrip.test.ts`・`src/tools/csv-json/csvFormat.test.ts`・`e2e/csv.spec.ts`・`e2e/calculation.spec.ts` |
| Base64 | `src/tools/base64/conversion.test.ts`・`src/tools/base64/presentation.test.ts`・`e2e/base64.spec.ts` |
| 正規表現 | `e2e/regex.spec.ts`・`src/tools/regex/logic.test.ts` |
| ハッシュ | `e2e/hash.spec.ts` |
| JWT | `e2e/jwt.spec.ts`・`e2e/cert.spec.ts`・`src/tools/jwt-decoder/verify.test.ts` |
| 証明書 | `e2e/cert.spec.ts`・`src/tools/cert/logic.test.ts` |
| JSON整形・和暦・テキスト差分 | `e2e/tools.spec.ts` |
| 独自休日の診断 | `src/tools/business-days/logic.test.ts` |
| UNIX時間の入力単位 | `e2e/unix-time.spec.ts`・`src/tools/unix-time/logic.test.ts` |
| 日時の拡張年と往復 | `src/lib/time/dateTimeInput.test.ts`・`e2e/unix-time.spec.ts` |
| UNIX時間の期間計算 | `src/tools/unix-time/logic.test.ts`・`src/lib/time/civilTime.test.ts`・`e2e/unix-time.spec.ts` |
| 営業日の期間集計 | `src/tools/business-days/logic.test.ts`・`e2e/business-days.spec.ts` |
| Kubernetesのcron式 | `src/tools/cron/logic.test.ts`・`e2e/cron.spec.ts` |
| cron の実行日時の貼り戻し | `e2e/cron.spec.ts`・`src/tools/cron/logic.test.ts`・`src/lib/time/dateTimeInput.test.ts` |
| UUID v7・ULID の生成順 | `src/tools/uuid/logic.test.ts` |
| UUID の形式と時刻 | `src/tools/uuid/logic.test.ts`・`e2e/tools.spec.ts` |
| サブネット | `e2e/subnet.spec.ts`・`src/tools/subnet/ipv4.test.ts`・`src/tools/subnet/ipv6.test.ts` |

純粋関数の境界値・大きな整数や小数の表記・日時の夏時間・パーサーの上限などは `src/**/*.test.ts` で検査します。ユニットテストの環境分離は、ストレージやモジュールの状態を他のテストへ漏らさないため維持します。

Workerの実行管理は `src/lib/worker/runWorker.test.ts` でも、待機中・実行中の中断、成功・打ち切り後の遅い応答、転送失敗と、失敗の文言を検査します。画面と実Workerの組み合わせは既存の計算・正規表現E2Eで確認します。

### 入力の境界と組み合わせ

複数の条件を組み合わせて初めて起きた不具合の、担当のファイルです。確かめる結果は、担当のファイル（E2E があれば E2E、なければ最初に挙げたファイル）の先頭のコメントに書いています。

| 条件 | テスト |
|---|---|
| 日本時間の日付・年の変更 × 誕生日・空の基準日・タブ復帰 | `e2e/tools.spec.ts`・`e2e/business-days.spec.ts` |
| UUID の括弧・ハイフン × バージョン・バリアント | `src/tools/uuid/logic.test.ts`・`e2e/tools.spec.ts` |
| ファイル名の大文字・未知の拡張子・拡張子なし × 現在の変換方向と区切り文字 | `src/tools/csv-json/fileOptions.test.ts`・`e2e/csv.spec.ts` |
| 証明書の開始・終了日時 × GeneralizedTime の小数秒・小数分 | `src/tools/cert/logic.test.ts`・`e2e/cert.spec.ts` |
| JSONのエスケープ × CSVの見出し・セル × UTF-8保存 | `src/tools/csv-json/writeCsv.test.ts`・`e2e/csv.spec.ts` |
| 曲線OID × 表示と署名検証 | `src/lib/crypto/curves.test.ts`・`src/tools/cert/verify.test.ts`・`src/tools/jwt-decoder/verify.test.ts` |
| 整数演算とIEEE754の分離 | `src/tools/radix/logic.test.ts`・`src/tools/radix/float.test.ts` |
| コピー × 対象の変更・書き込みの遅延・拒否・連続操作 | `e2e/copy.spec.ts` |
| クラウドの予約数 × IPv4・IPv6 × AWS・Azure のサイズ条件 | `src/tools/subnet/cloudPolicy.test.ts`・`src/tools/subnet/ipv6.test.ts`・`e2e/subnet.spec.ts` |
| 日時の上限・下限 × UTC・正負の時差 × 暦日と経過時間の相殺 | `src/tools/unix-time/logic.test.ts`・`e2e/unix-time.spec.ts` |
| Date の範囲より前の現地日付 × cron の曜日判定 | `src/lib/time/date.test.ts`・`src/tools/cron/logic.test.ts`・`e2e/cron.spec.ts` |
| 秘密鍵・共通鍵の混在 × kid 不一致・alg 不一致 × 配列の順序 | `src/tools/jwt-decoder/verify.test.ts`・`e2e/jwt.spec.ts` |
| パスワードの一括生成 × Unicode・除外・必須文字種 | `src/tools/password-generator/logic.test.ts` |
| 不完全なサロゲート × CR・LF・CRLF × 改行の数え方 | `src/tools/text-count/logic.test.ts`・`e2e/text-count.spec.ts` |
| 巨大なエポック × 範囲外・長い先頭の0・長い小数部 × 単位の指定 | `src/tools/unix-time/logic.test.ts`・`e2e/unix-time.spec.ts` |
| import × 文字列・式のないテンプレート・実行時の式 | `src/sourceScan.test.ts` |

## CSS を整理するときの見た目の比較

画面を描画する単体テストはなく、E2E は見た目の細かな違いを確かめません。CSS のファイルを分ける・規則を移す・層や読み込み順を変えるなど、見た目を変えないはずの整理では、`scripts/compare-styles.mjs` で変更の前と後を比べてください。

```bash
node scripts/compare-styles.mjs build before      # 変更する前に、今のソースをビルドする
node scripts/compare-styles.mjs build after       # 変更した後に、もう一度ビルドする
node scripts/compare-styles.mjs compare before after
```

ビルドは `.vite/compare-styles/<名前>` に置きます（`dist` は上書きしません）。`compare` は次の2つを比べ、違いがあれば表示して終了コード 1 で終わります。

- ビルドした CSS の規則の集まり（並びの違いは問わず、消えた規則・増えた規則を表示する）
- 全ツールとトップページの全要素の計算後のスタイル（PC 幅とスマートフォン幅。初期の状態・「サンプル」を押した状態・切り替えボタンを1つずつ押した状態）

ダークテーマ・マウスを乗せたとき・フォーカス・エラーの状態は比べないため、これらに関わる規則を動かしたときは目視でも確かめてください。生成したパスワードの一覧は、ランダムな文字で要素が変わるため比べません。

## 過去の実測・対象整理

[テストの測定記録](records/TESTING.md)に、2026-11-03の実測と2026-11-08の対象整理を残しています。現在の対象はこの文書と `playwright.config.ts`・`e2e/tags.ts` を参照してください。
