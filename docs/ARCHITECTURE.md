# 構成と設計方針

実装時の必須ルールは [CONTRIBUTING.md](../CONTRIBUTING.md)、レビュー観点は [AGENTS.md](../AGENTS.md) を参照してください。

## コードの配置

フォルダごとの役割を書きます。フォルダの中の個々のファイルの役割は、ファイルの先頭のコメント（ツールのフォルダは `index.tsx` の先頭）に書き、この表には書きません。ファイルを足したり移したりするたびに、この表を直さなくてよいようにするためです。

| 場所 | 役割 |
|---|---|
| `src/toolCatalog.ts` | ツールの一覧（ID・フォルダ名・名前・分類・入力を保存するか）。React に依存しないため、保存の処理・テスト・E2E からも読む |
| `src/registry.ts` | ツールの一覧に画面（遅延読み込み）を付けたもの。サイドバー・トップページ・コマンドパレットが使う |
| `src/App.tsx`・`src/app/` | アプリの入口と枠組み（ホーム・ツールページ・サイドバー・起動時の案内・テーマ・ナビゲーション） |
| `src/tools/<フォルダ名>/` | ツールごとの画面（`index.tsx`）・計算処理・専用のフック。フォルダ名はツールIDと別（`text-diff` と `diff` など。対応はツールの一覧の `folder`） |
| `src/components/` | 入力・出力・画面操作の共通部品 |
| `src/hooks/` | 保存・計算・時刻更新の共通の React フック |
| `src/lib/` | ツールに依存しない共通処理（ツール間でそろえる処理は「[共通の処理と決まり](#共通の処理と決まり)」）。関心ごとに `time/`（日時）・`text/`（テキスト）・`worker/`（Worker の起動と待機）・`storage/`（保存。[STORAGE.md](STORAGE.md)）・`crypto/`（証明書・JWT で共通の暗号の部品）に分ける |
| `src/calculation/` | 大容量計算の Worker（通信型・振り分け・入口・起動）。ツールを読み込んでよい、`src/tools/` の外の唯一の場所 |
| `csp.config.ts`・`src/trustedTypes.ts` | CSP と Worker 用 Trusted Types ポリシー |
| `src/styles.css`・`src/styles/` | CSSの層（cascade layers）と、テーマ・レイアウト・共通部品・ツール別スタイル |
| `e2e/` | 本番ビルドのブラウザテスト |

ツールのフォルダの中のファイルの分担は、ファイルが複数あるツールの `index.tsx` の先頭のコメントに書きます。ファイルを分けたり役割を変えたりしたときは、そのコメントを直します（この文書には書きません）。ツールをまたいでそろえている決まりは次のとおりです。

- 画面とテストは、関数が定義されているファイルから直接読み込みます（再 export はしません。静的検査あり）。例外は保存領域の入口（`src/lib/storage/index.ts`）で、ロックを迂回させないため、フォルダの外の画面・フックは入口だけを読み込みます（テストは中のファイルを直接読み込めます）。
- 計算処理は `logic.ts` を基本にし、責務が分かれるときはファイルを分けます。単体テストは、分けたファイルごとの `*.test.ts`（`parse.ts` なら `parse.test.ts`）を基本にします。専用のテストファイルを置かず、`logic.test.ts` でまとめて検査するときは、その先頭のコメントに対象のファイルを書きます（`cron`・`text-count` など）。
- 署名検証のように Web Crypto API を使う非同期処理は、`verify.ts` に分けます（JWT・証明書）。
- タブで画面を分けるツール（サブネット・営業日計算・UNIX時間など）は、`index.tsx` がタブとタブ間で共有する設定を担当します。
- ツール専用のフック（`use` で始まる関数）は `use<名前>.ts` に分けます（例：`jwt-decoder/useVerification.ts`）。共通のフック（`useAsyncFor` など）を1回呼ぶだけの短いフックは、使う画面のファイルに置いてかまいません。
- 画面の部品は、状態を直接持ってかまいません。ただし、ある状態の変更に合わせて別の状態も変える処理（入力を変えたらページを先頭に戻す、ファイルを読んだら編集履歴を作り直す、など）が増えたら、状態をまとめて `use<ツール名>.ts` に移します（例：`text-count/useTextCount.ts`）。画面の側で、変更のたびに同じ後始末を書き忘れないためです。
- 画面から呼ぶ判定（表示の切り替え・保存するファイル名など）も、`.tsx` に書かず純粋関数にして、単体テストで確かめます（`base64/presentation.ts` など）。
- CSS の読み込み順・クラスの置き場所・余白・色は、下の「[CSS の決まり](#css-の決まり)」にあります。
- テストからだけ読むファイルは、テスト用のデータを `*.fixtures.ts`、検査の補助の処理を `*.testing.ts` にします（`e2e/fixtures.ts` は Playwright の fixture で、別の意味です）。どちらも静的検査の対象外で、アプリのソースからの読み込みは静的検査で禁止しています。

## CSS の決まり

CSS は `src/styles/` に置き、入口の `src/styles.css` から読み込みます。このリポジトリには画面を描画する単体テストがないため、次の決まりは単体テスト（`src/styles.classes.test.ts`・`src/styles.contrast.test.ts`）で確かめ、見た目は E2E と目視で確かめます。見た目を変えないはずの整理（ファイルを分ける・規則を移す・読み込み順を変える）では、変更の前と後の計算後のスタイルを比べます（[TESTING.md の「CSS を整理するときの見た目の比較」](TESTING.md#css-を整理するときの見た目の比較)）。

### 読み込みの層

入口では、各ファイルを CSS の cascade layers の層（`@import '…' layer(parts);`）に入れて読み込みます。後の層の規則は、詳細度に関係なく前の層の規則より優先されます。同じ層の中では、詳細度と読み込み順で決まります。新しいファイルは、該当する層の見出しの下に、層の名前を付けて置きます。

| 層（名前） | ファイル | 置くもの |
|---|---|---|
| 1. テーマの変数（`theme`） | `theme.css`・`theme-status.css` | ライト・ダークの色と大きさの変数だけ |
| 2. 要素の基本（`base`） | `base.css` | 要素（`body`・`a` など）の既定の見た目 |
| 3. 部品（`parts`） | 部品ごとのファイル（`pane.css`・`badge.css`・`forms.css` など。名前は `src/components/` の部品に合わせる） | 2つ以上の画面、または共通の部品が使うクラス |
| 4. アプリの枠組み（`app`） | `layout.css`・`home.css` | サイドバー・本文・ツール画面の枠と、トップページ（`src/app/` だけが使うクラス）。枠組みの中で部品の見た目を変える規則（`.sidebar-theme .seg` など）があるため、部品の後に置く |
| 5. ツール別（`tools`） | `<ツールのフォルダ名>.css` | そのツールだけが使うクラス。ツールごとにクラスが分かれているため、この層の中の順は問わない |
| 6. 縦の並びの余白（`stack`） | `stack.css` | 下の「余白」の規則だけ |

どのファイルがどの層かは、入口の番号付きの見出し（`/* 3. … */`）の下に並べることで決め、検査もそこから読みます。部品の CSS を足すときに、検査の側を直す必要はありません。`src/styles.classes.test.ts` は、読み込み忘れ・二重の読み込み、見出しと層の名前（`layer(...)`）の対応、`@layer` の宣言の順、クラスの置き場所を確かめます。置き場所の例外（選んだ状態を表す `.on` など）は、理由と一緒にそのテストの `ALLOWED` に書きます。

### 余白

縦に並べた部品の間の余白は、親が決めます。ツールの画面（`.tool`）と、その中で部品を縦に並べる入れ物（`.stack` を付ける）は `src/styles/stack.css` の規則で、flex・grid の入れ物は `gap` で余白を作ります。

- 部品の側に上下のマージン（片側だけのものを含む）や、組み合わせごとの例外（`.field + .toolbar` など）を足さないでください。部品の並びによって余白が 0px になったり、flex の中で `gap` に足されて不ぞろいになったりするためです。
- 例外は見出し（`h2`・`h3`・`.section-title`・`.sub-title`）で、見出しの前後の余白は見出しの側のマージンで決めます。
- 部品を `.tool` 直下以外のブロックの入れ物（`section`・`details`・`Notice` など）に縦に並べるときは、その入れ物に `.stack` を付けます。

### 画面幅の切り替え

切り替えの幅は `src/app/breakpoints.ts` の `BREAKPOINTS` にある2つだけを使います（760px 以下でサイドバーをメニューにたたみ、960px 以下で2列の並びを1列にする）。`@media` の条件には CSS の変数を書けないため、CSS には数を直接書き、`src/styles.classes.test.ts` でこの値と照らし合わせます。メニューを閉じる処理（`src/app/useAppNavigation.ts`）の matchMedia も同じ値から作るので、片方だけを変えると検査が失敗します。

### 色とコントラスト

色は `theme.css`・`theme-status.css` の変数だけを使い、文字と背景のコントラスト比を 4.5:1 以上にします。使っている文字と背景の組み合わせは `src/styles.contrast.test.ts` に挙げ、ライト・ダーク（OS の設定と手動の切り替えの両方）で確かめます。新しい組み合わせを使ったときは、そのテストに足します。コントラストの検査も、入口と同じ順で分割先を読み込みます。

## 設計上の選択

- **ロジックとUIの分離**：各ツールの計算処理は画面から分離し、Vitestで検査します。画面と計算を組み合わせた操作はE2Eで確かめます。
- **ツールの一覧**：`src/toolCatalog.ts` に1件追加するだけで、画面の読み込み（`folder` から）・サイドバー・トップページ・コマンドパレット・入力の保存の対象（`savesInput`）に反映されます。
- **遅延読み込み**：ツールごとに `React.lazy` で分割し、初回表示を軽くしています。
- **値を変えない**：JSON整形は自前のパーサで数値・文字列を元の表記のまま出力します。CSV の型変換も「数値にして元の表記に戻る値」だけを数値にします。
- **画面を止めない**：大容量の計算をWorkerへ分離し、全文データとプレビューを区別します。差分は線形メモリの Myers 法で計算し、MD5はチャンクごとに計算して進捗を表示します。入力・表示・打ち切りの上限は [USAGE.md](USAGE.md)、計測手順は [PERFORMANCE.md](PERFORMANCE.md) にまとめています。
- **外部ライブラリに頼らない**：差分（Myers 法）、CSV パーサ、祝日計算、MD5、証明書の ASN.1 の解析は自前実装です。Shift_JIS・EUC-JP の判定はブラウザ標準の `TextDecoder` から変換表を作っています。
- **乱数の安全性**：パスワード生成は `crypto.getRandomValues` を使い、剰余による偏りを避けるため棄却サンプリングで文字を選んでいます（`Math.random` は使用しません）。

## 共通の処理と決まり

ツールごとに書くと扱いが食い違いやすい処理は、共通の処理にまとめ、静的検査（`src/architecture.test.ts`）やテストで守らせています。静的検査の書き方の規則と、その検出例・許可例は `src/sourceRules.testing.ts` にあります。

共通の処理の一覧は、この表だけに書きます。表には入口と、守らせる静的検査・入口の単体テストだけを書き、使い方の細かい条件は入口のファイルの TSDoc に書きます（表と TSDoc で同じ説明を二重に持たないため）。どの E2E がその処理を守るかは、テストの移動で変わりやすいため、[TESTING.md の「既知不具合を守るテスト」](TESTING.md#既知不具合を守るテスト)に任せます（表の「E2E」は、単体テストや静的検査がなく、E2E だけで確かめるものです）。[CONTRIBUTING.md](../CONTRIBUTING.md#コードの書き方) と [AGENTS.md](../AGENTS.md) は、この表を参照し、それぞれ実装の決まりとレビューで見る点だけを書きます。共通の処理を足したり変えたりしたときは、この表を直してください。検査の一覧は [TESTING.md](TESTING.md#ソースとドキュメントの検査) にあります。

| 関心事 | 使う処理 | 守らせる検査 |
|---|---|---|
| 外部との通信 | 使わない（本番は CSP の `connect-src 'none'`） | 静的検査（構文木から通信の API の参照を探す） |
| 入力の保存 | `src/hooks/useInput.ts`・`src/lib/storage/index.ts`（入口。詳しくは [STORAGE.md](STORAGE.md)） | 静的検査（内部モジュールを直接使わない）・`src/lib/storage/index.test.ts`・`src/lib/storage/clear.test.ts` |
| 表示設定の保存 | `src/hooks/usePreference.ts`（検証関数は `src/lib/settings.ts`、タイムゾーンは `src/lib/time/timezone.ts` の `isStoredZone`） | `src/lib/settings.test.ts`・`src/lib/storage/preferences.test.ts` |
| 大きな入力欄 | `src/components/LargeTextInput.tsx` | 静的検査（ツールの画面で普通の `textarea` を使わない） |
| 大容量の計算 | `src/hooks/useCalculation.ts`・`src/calculation/protocol.ts`・`src/lib/worker/calculationLimits.ts`（Worker の扱いは正規表現と共通の `src/hooks/useWorkerJob.ts`。流れは「[計算と表示の流れ](#計算と表示の流れ)」） | 静的検査（`runWorker` を `useWorkerJob` の外で呼ばない。振り分けを Worker の入口の外で読み込まない）・`src/calculation/handlers.test.ts`・`src/lib/worker/runWorker.test.ts` |
| 画面の非同期の結果（署名の検証・指紋・ハッシュなど） | `src/hooks/useAsyncFor.ts`（計算処理に渡す型は `src/lib/asyncContext.ts` の `AsyncContext`） | 静的検査（取り消しの印 `cancelled` を画面で直接持たない） |
| ファイルの読み込み | `src/hooks/useFileLoader.ts`（ツールの画面の入口）・`src/lib/file.ts`（`readFileWithin`・上限超過と読み込み失敗の文言） | 静的検査（`arrayBuffer` と上限超過の文言を直接書かない）・`src/lib/file.test.ts` |
| テキストの行 | `src/lib/text/lines.ts`（`splitLines`。CRLF・LF・CR とその混在を区切りにする。行の文字列を作らずに走査するときは、同じ規則の `eachLineRange`（行の範囲）・`endsLineAt`（位置で行が終わるか）） | 静的検査（`split` に改行を直接渡さない）・`src/lib/text/lines.test.ts` |
| UTF-8 にできない文字の検出 | `src/lib/text/surrogate.ts`（`findLoneSurrogate`・`describeAt`・`replacementWarning`。拒否と警告の使い分けは [USAGE.md](USAGE.md#utf-8に変換できない文字)） | 使う側の単体テスト（CSV・Base64・ハッシュ・署名） |
| 長い出力の表示 | `src/components/FormattedOutput.tsx` の `TextOutputPreview` | 静的検査（ツールの画面で `textPreview` を直接呼ばない。差分の行は除く） |
| 長い1つの値（表のマス・一覧の項目） | `src/components/ClippedText.tsx` | E2E |
| 項目名と値の表の行 | `src/components/KvRow.tsx` | E2E |
| 見出し付きの入力・出力の欄 | `src/components/Pane.tsx` | 静的検査（`pane`・`pane-head` のクラスを直接書かない） |
| バッジ（件数・種類・判定の結果） | `src/components/Badge.tsx` | 静的検査（`badge` のクラスを直接書かない）・`src/styles.contrast.test.ts` |
| 件数の多い一覧 | `src/lib/listPreview.ts` の `previewList`・`src/components/ListRest.tsx` | `src/lib/listPreview.test.ts` |
| エラーの表示 | `src/components/ErrorMessage.tsx` の `ErrorText`・`ErrorBox`（`children` には入力を含まないものだけを置く） | 静的検査（`error-text`・`error-box` のクラスを直接書かない） |
| 案内・警告・判定の結果の表示 | `src/components/Notice.tsx`（入力を含む文言は `message` で渡し、`children` には置かない） | 静的検査（`notice` のクラスを直接書かない） |
| エラー・警告・バッジ・見出しに入れる入力 | `src/lib/text/textPreview.ts` の `detailPreview`（作る側で抜粋にする。文言の途中の長い入力で、後ろの理由が表示の上限で切れるため） | `src/lib/text/textPreview.test.ts`・使う側の単体テスト |
| 例外の文言 | `src/lib/errors.ts` の `errorMessage`（描画中の計算は `attempt`） | 静的検査（`(e as Error).message` を書かない）・`src/lib/errors.test.ts` |
| コピーと完了通知 | `src/components/CopyButton.tsx`（条件は「[非同期の結果を表示できる条件](#非同期の結果を表示できる条件)」） | E2E |
| 択一の切り替え | `src/components/Segmented.tsx` | E2E |
| チェックボックス | `src/components/Check.tsx` | E2E |
| キー操作 | `src/lib/keyboard.ts` の `isImeComposing` | 静的検査（`keyCode === 229`・`nativeEvent.isComposing` を直接書かない） |
| 日時の解析と表示 | 解析は `src/lib/time/dateTimeInput.ts`、表示は `src/lib/time/dateTimeFormat.ts`、変換と範囲の判定は `src/lib/time/timezone.ts`（範囲外は `DateRangeError`、夏時間で飛ばされる時刻は `NonexistentTimeError`。日本時間は `JST_ZONE`） | 静的検査（`'Asia/Tokyo'` を直接書かない。`getHours` などの現地時刻のメソッドを使わない）・`src/lib/time/dateTimeInput.test.ts`・`src/lib/time/dateTimeFormat.test.ts`・`src/lib/time/timezone.test.ts` |
| 数の書式（件数・文字数・バイト数の3桁区切り） | `src/lib/number.ts` の `formatNumber` | 静的検査（`toLocaleString` を直接呼ばない）・`src/lib/number.test.ts` |
| 今日の日付 | `src/hooks/useTodayJst.ts` | `src/lib/time/date.test.ts` |
| 暦の中間計算 | `src/lib/time/civilTime.ts`（`src/lib/time/date.ts` と `src/lib/time/timezone.ts` の `addZonedElapsed` も同じ計算を使う） | `src/lib/time/civilTime.test.ts` |

## 計算と表示の流れ

ツール固有の計算の流れ（サブネットの予約数、文字数の UTF-8 集計、JWK Set の検査の順番など）は、この文書ではなく、そのツールの計算処理の TSDoc に書きます。

通常の変換は、ツールの画面から計算処理を呼び、結果やエラーをテキストとして描画します。JSON整形とCSVは `src/lib/jsonTree.ts` を共有します。日時は `src/lib/time/timezone.ts` の変換、`src/lib/time/dateTimeInput.ts` の入力解析、`src/lib/time/dateTimeFormat.ts` の表示を各呼び出し側が直接読み込みます。これらの共通処理はツールの画面に依存しません。

大容量計算は次の順に進みます。

1. JSON整形・CSV変換・文字数計算・テキスト差分・UNIX時間の一括変換・Base64（10万単位を超えるテキスト）・サブネットの集約、重複チェック、VLSMの画面が、入力と設定を `useCalculation` に渡す。
2. フックが入力上限の確認を加えて `useWorkerJob` に渡し、入力変更の待機の後、`src/calculation/createWorker.ts` の `createCalculationWorker` でWorkerを起動する。
3. `src/calculation/worker.ts` が要求を受け取り、`src/calculation/handlers.ts` の `calculate` がツールのロジックを呼ぶ。ツールごとの処理は `HANDLERS` の表にあり（結果の形を整える処理はツールの側に置き、表は呼ぶだけにする）、要求と結果の型の組をコンパイル時に確かめる。応答にはツールの種類（`tool`）を含める。
4. フックが現在の要求に対応する結果だけを画面へ返す（要求と違うツールの結果はエラーにする）。入力変更・中断・画面移動時はWorkerを終了する。

Worker で計算するツールを加えるときは、次の2つに足します。要求と結果の型の組は、コンパイル時に確かめられます。

- 要求と結果の型：`src/calculation/protocol.ts` の `CalculationRequest`・`CalculationResults`
- 処理：`src/calculation/handlers.ts` の `HANDLERS`。結果の形を整える処理（警告の件数・要約の文言など）が要るときは、ツールのフォルダの `calculation.ts` に置きます

古い入力の結果は表示しません。例外はテキスト差分だけで、計算中に限り前回の結果を表示します。入力のたびに表示が消えて、画面が跳ねないようにするためです。ほかのツールにこの例外を広げるときは、下の「[非同期の結果を表示できる条件](#非同期の結果を表示できる条件)」の表と同じ条件（計算中の表示・コピーの無効化・中断と失敗での非表示）をそろえ、表に追記してください。

通信型は `src/calculation/protocol.ts`（型だけ）、上限は `src/lib/worker/calculationLimits.ts` にあり、画面から計算実装を実行時に読み込まずに参照できます。振り分け（`handlers.ts`）は全ツールの計算処理を読み込むため、Worker の入口だけが読み込みます（静的検査あり）。正規表現は専用のWorkerを使い、待機・タイムアウト・終了後の応答破棄・今の入力の結果だけを返すことは、大容量計算と共通の `useWorkerJob`（中で `runWorker`）で管理します。失敗の文言は `runWorker.ts` の `workerFailureMessage` でそろえ、制限時間・打ち切ったときの案内・開始前の確認・未操作状態は各呼び出し側が決めます。

どちらもビルド時に `?worker-source` でまとめたコードから `createTrustedWorker` が起動します。CSP・Trusted Typesの安全対策と限界は [SECURITY.md](../SECURITY.md) を参照してください。

大きな文字列は全文を計算・コピー・保存に使い、画面への表示量を制限します。`LargeTextInput` と `src/lib/text/textEdit.ts` は編集・Undo／Redoを扱い、編集履歴はメモリ内だけに保持します。

### 非同期の結果を表示できる条件

`src/components/CopyButton.tsx` はクリック時の対象と要求番号を保持し、現在の対象・操作と一致した完了だけを表示します。対象変更・画面移動で解除タイマーを取り消し、待機・成功・失敗を区別します。クリップボードへの書き込み自体は取り消せないため、古い処理の通知を捨てる方式です。失敗は共通のエラー表示で知らせ、再試行できます。

| 状態・操作 | 表示と結果の利用 |
|---|---|
| 計算や検証が完了 | 結果と要求、証明書、鍵などを組にし、現在の入力と一致するときに表示・利用する。署名の検証・指紋などの画面の非同期処理は `src/hooks/useAsyncFor.ts` で組にする |
| 入力変更・計算中 | 変更直後の描画から前の結果を利用できなくする。テキスト差分は計算中だけ前回の結果を表示し、コピーを無効にする |
| 計算の中断・失敗・打ち切り | 差分の前回結果を含め、結果を表示・利用できなくする |
| ファイルの選択・編集・画面移動 | `useFileLoader` で最後に開始した有効な読込みだけを反映する。読込み後に要求が変われば、以前の計算結果はコピー・保存できなくなる |
| ファイル読込み中・失敗 | Base64と証明書は選択時点で前の出力を消す。CSVは読込み成功まで現在の入力を維持するため、失敗しても現在の入力に対する結果は利用できる |

## ツール間の依存

ツール（`src/tools/<フォルダ名>/`）は、ほかのツールのコードを読み込まず、共通の処理は `src/lib/` に置きます。今は例外がなく、ツール同士の import を加えるとソースの静的検査（`src/architecture.test.ts`）が失敗します。

サブネット計算と証明書デコーダー（別名・名前の制約の IP アドレス）は、IPv6 アドレスの推奨表記（RFC 5952）を `src/lib/ipv6.ts` の `formatIpv6Groups` で共有し、同じアドレスを同じ表記で表示します。

証明書デコーダーと JWT デコーダーが使う暗号の部品は `src/lib/crypto/` にあります。

| ファイル | 役割 |
|---|---|
| `asn1.ts` | DER（ASN.1）の解析 |
| `pem.ts` | PEM のブロック（BEGIN〜END）と本文の標準の Base64 の読み取り。受け付ける種類・ブロックの数は呼び出し側が決める |
| `privateKey.ts` | 秘密鍵の検出（解析も保存もしないため、見た目と外側の型だけで判定する） |
| `curves.ts` | 曲線の OID・名称・ビット数・Web Crypto 対応を共有する。表示と署名検証の可否の判断は呼び出し側に残す |
| `signature.ts` | 署名の検証結果（`SignatureVerification`）と Web Crypto API のハッシュ名の型。受け付けるアルゴリズムと文言は各ツールが決める |
| `spki.ts` | 公開鍵（SubjectPublicKeyInfo）の種類と ECDSA の曲線の判定 |
| `x509.ts` | 証明書から、公開鍵と主体の CN だけを取り出す（JWT の検証の鍵） |

証明書の表示・チェーンの確認・署名の検証の規則は `src/tools/cert/`、JWS の検証の規則は `src/tools/jwt-decoder/` に残します。

`src/lib/` は `src/tools/` も `src/calculation/` も読み込みません（例外なし）。複数のツールの計算をまとめて呼ぶ処理は `src/calculation/` に置きます。`src/calculation/` を読み込むと、Worker のコード（`?worker-source`）を通じて全ツールの計算処理に依存するためです。この境界も静的検査で確認します。同じ静的検査で、通信の API・HTML の挿入・`eval`・`?worker` での Worker の読み込みも禁止しています。

## 保存の流れ

入力は `useInput`（sessionStorage だけ）、表示設定は `usePreference`（検証した値だけを localStorage）、トークン・鍵などの機密値は `useState`（メモリ内だけ）で持ちます。保存の処理は `src/lib/storage/` にまとめ、フォルダの外からは入口の `src/lib/storage/index.ts` だけを読み込みます（静的検査あり）。保存先・保存キー・全消去とタブ間の調整・起動時の古いキーの整理は [STORAGE.md](STORAGE.md) にあります。

## 説明の置き場所

- 操作・保存・制約：[USAGE.md](USAGE.md)
- 保存先・全消去とタブ間の調整・起動時の古いキーの整理：[STORAGE.md](STORAGE.md)
- 安全対策と脆弱性の報告：[SECURITY.md](../SECURITY.md)
- コメントの書式と例：[COMMENTING.md](COMMENTING.md)
- 検査対象と実行方法：[TESTING.md](TESTING.md)
- 大容量処理の計測方法・過去の記録：[PERFORMANCE.md](PERFORMANCE.md)
