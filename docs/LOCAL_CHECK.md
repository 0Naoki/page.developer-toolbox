# ローカルでの動作確認手順

GitHub Pages に公開する前に、手元の PC で次の順に確認します。
**1〜3 は自動確認、4〜5 はブラウザで目視確認、6 は変更内容の確認**です。テストのコマンド・対象・回帰防止の方針は [TESTING.md](TESTING.md) を参照してください。

## 0. 準備（初回のみ）

Node.js は `.nvmrc` の24を推奨します。対応範囲は [package.json](../package.json) の `engines.node` です。
22.12以上の22、24、26以上に対応し、23・25は対象外です。CIが使用する版は `.nvmrc` に合わせます。

```bash
node -v   # 推奨は v24.x。上記の対応範囲に入ること
```

入っていない、または古い場合はバージョン管理ツールで入れます。

- Windows：`winget install Volta.Volta` → 新しいターミナルで `volta install node@24`
- macOS / Linux：`nvm install` （`.nvmrc` を読んで 24 を入れる）

コミット済みの `package-lock.json` に従って依存パッケージを入れます。`npm run setup` は CI と同じ手順で、インストールスクリプトを実行せずに取得し（`npm ci --ignore-scripts`）、npm レジストリの署名を検証します（`npm run audit:signatures`）。

```bash
npm run setup
npm run e2e:install   # E2E テスト用のブラウザ（Chromium・Firefox・WebKit）。初回のみ
```

### Windowsの起動スクリプト

Windowsでは、リポジトリ直下の `start.ps1` をPowerShellから実行して起動できます。
依存パッケージの準備が済んでいなければ `npm run setup` で準備し、毎回本番ビルドを作成して、CSPが有効な画面をブラウザで開きます。
準備が済んだかは、署名の検証が通ったときに `node_modules/.dev-toolbox-verified` に書く `package-lock.json` のハッシュで判断します。取得や検証の途中で止めたときや、`git pull` などで `package-lock.json` が変わったときは、準備し直します。取得や検証に失敗したら、取得した依存パッケージを削除して止まります。
表示先は `http://localhost:4173/dev-toolbox/`、停止は起動したウィンドウで `Ctrl+C` です。
ポート4173が使用中の場合は、既存のサーバーを停止してから起動します。

リポジトリのフォルダーで、次のコマンドを実行します。実行ポリシーの指定は、このPowerShellプロセスだけに適用されます。

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\start.ps1
```

Windows PowerShell 5.1とPowerShell 7に対応しています。ダウンロードしたスクリプトがブロックされている場合は、内容を確認してからファイルのプロパティで「許可する」を選んでください。

続けてE2Eを実行する場合は、先にこのプレビューを停止してください。E2Eもポート4173を使います。

## 1. 型チェック・単体テスト・本番ビルド

[TESTINGの実行コマンド](TESTING.md#実行コマンド)に従って `npm run check` を実行します。成功したビルドを手順3で使います。

## 2. 依存パッケージの安全性

```bash
npm run audit
```

npm レジストリの署名の検証（`audit:signatures`）と、公開物に含まれる依存の重大な脆弱性の検査（`audit:deps`）を順に行います。CI も同じスクリプトを使うので、オプションは `package.json` の `scripts` だけに書きます。

## 3. 本番相当のブラウザテスト

[TESTINGの実行コマンド](TESTING.md#実行コマンド)に従い、手順1で作った本番ビルドを検査します。ソースを変更した場合は先にビルドし直してください。ビルドし直していなければ、E2E は古いビルドを検査せずに止まり、`npm run build` を案内します。

対象ブラウザ・回帰テストの一覧・失敗時の記録の開き方は [TESTING.md](TESTING.md) にあります。ブラウザの起動に失敗した環境は、検査成功として扱わないでください。

## 4. 開発サーバーで画面を確認

```bash
npm run dev
```

http://localhost:5173 を開き、次を目視で確認します。

自動化済みの不具合と検査ファイルの対応は [TESTING.md](TESTING.md) にまとめています。目視では、変更した画面と次の操作感を重点的に確認します。

- [ ] サンプルや境界値を入力し、結果とエラーメッセージが読み取りやすいか
- [ ] 大きな入力の貼り付け・全文編集・Undo／Redo・中断・画面移動で操作が固まらないか（計測手順は [PERFORMANCE.md](PERFORMANCE.md)）
- [ ] キーボードだけで操作でき、IME変換・フォーカス・スクロールが自然か
- [ ] 実OSのIMEで、文字数入力の1,999単位の末尾から変換を始め、上限を超えても候補を選択・確定・取消できるか
- [ ] 補助平面文字129種類を含む499単位の入力でも、変換中は編集可能で、確定・取消後の全文が正しいか
- [ ] 確定後に全文編集からUndo／Redoを行っても、変換途中の文字に戻らず、フォーカスとキャレットが自然か
- [ ] OSのライト・ダーク両方で、文字・選択状態・エラーが見やすいか
- [ ] スマホ幅（390px前後）で、入力欄・ボタン・表が操作できるか
- [ ] 入力がタブ内だけに残ること、全消去、保存失敗時の警告と復旧手順が理解できるか

> 開発サーバーでは CSP を無効にしています（自動再読み込みの通信を止めないため）。CSP の確認は次の 5 で行います。

## 5. 本番ビルドを GitHub Pages と同じ形で確認

```bash
npm run preview:pages
```

http://localhost:4173/dev-toolbox/ を開きます（公開時の `https://<組織名>.github.io/page.developer-toolbox/` と同じく、サブパスで配信する構成）。

手動起動・Windowsの起動スクリプト・E2Eは同じプレビュー設定（`pages-preview.config.ts`）を使います。ポート4173が使用中なら起動に失敗します。ビルド済みの `dist` を手動で配信する場合は `npm run serve:pages` を使います。

- [ ] 開発者ツールの **Console** に赤いエラー（特に `Refused to ...` で始まる CSP 違反）が出ていないこと
- [ ] **Network** タブで、ツールを操作しても `localhost` 以外への通信が出ないこと
- [ ] **Elements** タブで `<head>` の先頭に `<meta http-equiv="Content-Security-Policy" ...>` があること
- [ ] **Application** タブ → Storage で、入力は Session storage にだけあり、Local storage には表示設定（`dev-toolbox:pref:`）と消去世代しかないこと。JWT・HMACの鍵・生成したパスワードはどちらにも残らないこと
- [ ] CSV の「保存」、ハッシュのファイル読み込み、各「コピー」ボタンが動くこと
- [ ] CSV のファイル読込中に手入力・クリア・サンプル・入れ替え・設定変更・画面移動を行っても、後から古い読込結果で上書きされないこと。読込失敗では現在の入力を保持してエラーを表示し、キャンセル済みの失敗は表示しないこと
- [ ] JSON で入力を空欄にしてから「クリア」を押すと、Undo・Redo で以前の入力が復活しないこと。同じサンプルを再適用した場合も履歴が破棄されること

公開先のリポジトリ名（`page.developer-toolbox`）は確認用のパス（`/dev-toolbox/`）と異なりますが、`base: './'` のため本番ビルドの設定変更は不要です。確認環境も公開先の名前に揃える場合は、`pages-preview.config.ts` のパスを変更してください。

## 6. コミット前の最終確認

```bash
git status
git ls-files            # 意図しないファイル（.env、鍵、個人のメモなど）が含まれていないか
```

- [ ] サンプルデータやスクリーンショットに、実在の顧客名・社内情報が入っていないか

初回公開では、これまでの履歴は送らず、管理対象のファイルだけを1つ目のコミットにして送ります。送る前の確認は [公開するファイルの確認](PUBLISHING.md#公開するファイルの確認) を参照してください。

## うまくいかないとき

| 症状 | 対処 |
|---|---|
| `npm run setup` で engines のエラー | 対応していない版の Node.js。手順 0 で 24 を入れる（22.12 以上の 22 と、26 以上でも動く。23・25 は対応しない） |
| `npm run e2e` で「ブラウザがない」 | `npm run e2e:install` を実行（Linux は `npx playwright install --with-deps chromium firefox webkit`） |
| Windows で Firefox だけが `spawn UNKNOWN` で起動しない | PC の環境によって、Playwright の Firefox が Windows に起動を止められることがある。手元では `npx playwright test --project=desktop --project=mobile --project=webkit --project=iphone` で残りを確認し、Firefox は CI（Linux）の結果で確認する |
| `Port 4173 is already in use` | 前回のプレビューを、そのサーバーを起動したターミナルで `Ctrl + C` により停止する。E2Eは4173番を使うため、別ポートのプレビューでは代用できない |
| 改行コードの差分だけが大量に出る | `.gitattributes` で LF に統一済み。`git add --renormalize .` を一度実行する |
