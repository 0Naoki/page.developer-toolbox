# GitHub Pages への公開手順とリポジトリ設定

設定ファイルで対応できない項目は、GitHub の画面で設定します。上から順に進めてください。

## 運用の方針（変わらないこと）

- 個人のアカウント、またはほかの Pages サイトがある組織で公開する。同じオリジン（`https://<組織名>.github.io`。以下、公開するアカウントまたは組織の名前を `<組織名>` と書く）のほかのサイトは、このアプリの信頼範囲の内側になる（[SECURITY.md](../SECURITY.md) の「同じオリジンのほかのサイト」）。
- 入力を localStorage に保存しない（理由は上と同じ）。
- 公開は `main` ブランチから GitHub Actions でだけ行う。
- 2要素認証を必須にし、Actions の権限は最小限にする。

## 外部サービスの情報と運用記録

この文書の画面名（Settings → … など）と、無料・有料の条件は、GitHub の変更で変わることがあります。設定する前に [GitHub Docs](https://docs.github.com/ja) で確かめてください。手順は、公開用のリポジトリを作り直すときにもそのまま使えるように書いています。このリポジトリで実際に確かめた結果（確認日・対象・結果・根拠）は [運用記録](records/PUBLISHING.md) に残します。

## 1. アカウント

- [ ] GitHub アカウントで**2要素認証（2FA）**を有効にする（Settings → Password and authentication）

### 公開するアカウントと、同じオリジンのサイト

公開先は、個人のアカウントでも、ほかの Pages サイトがある組織でもかまいません。
GitHub Pages では、同じアカウント（または組織）で公開するサイトがすべて同じオリジン（`https://<組織名>.github.io`）になり、
localStorage・sessionStorage や画面の中身を互いに読めます。そのため、次を守ってください。

- [ ] 組織で公開する場合は、組織の **Settings → Authentication security** で **Require two-factor authentication** をオンにする
- [ ] `<組織名>.github.io` という名前のリポジトリ（アカウント直下のサイト）を作らない。アカウント直下のサイトは、Service Worker で `/page.developer-toolbox/` を含む全体の通信を横取りできるため
- [ ] 同じオリジンのほかの Pages サイトに、外部のスクリプト（広告・アクセス解析・CDN のライブラリなど）を読み込むサイトや、第三者が内容を変えられるサイトを置かない
- [ ] 同じオリジンにサイトを追加するときは、上の2つ（アカウント直下のサイトを作らない・外部のスクリプトや第三者が変えられる内容を置かない）を満たすか確かめる。同じアカウント（または組織）のほかのリポジトリで Pages を有効にすることも、サイトの追加にあたる。Pages を有効にする前に確かめる

## 2. リポジトリの作成と初回 push

**公開するアカウント（または組織）に** **Public** リポジトリ `page.developer-toolbox` を作成します（README などは追加しない）。
これまでのコミット履歴は送りません。公開リポジトリを新しいフォルダに clone し、今の作業フォルダの管理対象のファイルだけをコピーして、1つ目のコミットにします（開発中の履歴には、公開を前提にしていない記録やコミットメッセージが含まれるため）。

以下では、今の作業フォルダを `<今のフォルダ>`、clone するフォルダを `<公開用のフォルダ>`（例：`../page.developer-toolbox`）と書きます。コマンドは Git Bash で実行します。

送る前に、[.github/ISSUE_TEMPLATE/config.yml](../.github/ISSUE_TEMPLATE/config.yml) の脆弱性の報告先が、公開先（`https://github.com/<組織名>/page.developer-toolbox/security/advisories/new`）になっているか確かめてください。違っていると、Issue の「脆弱性の報告（非公開）」のリンクが開けません。

### 公開するファイルの確認

`<今のフォルダ>` で実行します。公開されるのは、管理対象のファイル（`git ls-files` に出るもの）の**今の中身**です。未コミットの変更もそのまま公開されます。`.gitignore` で除外したファイル（`.claude/` など）は含めません。

```bash
cd <今のフォルダ>
git status --short # 出た変更が、公開してよいものだけであること
git ls-files
```

ファイル名に加え、中身に公開できない情報（秘密・個人の情報・非公開のリポジトリの名前など）がないかを確認してください。バイナリなど中身を判別できないファイルは、ローカルで開いて確かめます。シークレット検査も併用し、結果はローカルで扱ってください。秘密が見つかった場合はコピーを止め、取り除いてから再確認します。その鍵を外部に送ったことがあれば、失効・再発行します。

### clone してファイルをコピーする

```bash
git clone https://github.com/<組織名>/page.developer-toolbox.git <公開用のフォルダ> # 空のリポジトリという警告が出てよい
cd <今のフォルダ>
git ls-files -z | xargs -0 cp --parents -t <公開用のフォルダ>
```

- **フォルダの中身をまとめてコピーしないでください**。`.git` をコピーすると clone した `.git` が上書きされ、これまでの履歴と `origin`（private リポジトリ）が持ち込まれます。除外したファイル（`.claude/`・`node_modules/`・`dist/`・ログなど）も混ざります。
- **`git archive` は使わないでください**。`.gitattributes` の `export-ignore` で、`.gitattributes`・`.gitignore` が抜け落ちます。
- `.claude/launch.json` など手元専用の設定が必要なら、ファイルごとに個別にコピーします（`.gitignore` で除外されるのでコミットされません）。

### 1つ目のコミットを作って送る

`<公開用のフォルダ>` で実行します。

```bash
cd <公開用のフォルダ>
git branch --show-current # main であること（違う場合は git symbolic-ref HEAD refs/heads/main）
git add -A
git status --short # 追加（A）だけで、.claude/ や dist/ を含まないこと
diff <(git -C <今のフォルダ> ls-files) <(git ls-files) # 何も出ないこと（同じファイルがそろっていること）
npm run setup
npm run check
git commit -m "chore: 初回公開"
git log -1 --format=fuller # 著者のメールアドレスが、公開してよいもの（…@users.noreply.github.com など）であること
```

```bash
git -c push.followTags=false push -u origin main # 先に main を送る（空のリポジトリに最初に送ったブランチが既定のブランチになるため）
git switch -c develop
git -c push.followTags=false push -u origin develop
```

- 改行は `.gitattributes` でそろえており、コピーしても変わりません（`start.ps1` だけ CRLF）。
- GitHub の **Settings → General → Default branch** が `main` になっていることを確認してください。
- 以降の作業は `<公開用のフォルダ>` で行います。`<今のフォルダ>` に公開リポジトリをリモートとして追加しないでください。そこから push すると、これまでの履歴が公開されます。今の private リポジトリと `<今のフォルダ>` は、そのまま残してかまいません。

> 初回 push の時点では Pages の設定がまだなので、「Deploy to GitHub Pages」ワークフローは失敗します。3 の設定後に再実行してください。

## 3. GitHub Pages

> 「Deploy to GitHub Pages」は公開リポジトリのときだけ動きます。GitHub Free の private リポジトリでは Pages を使えないため、private の間は main に push してもスキップされます（エラーにはなりません）。

- [ ] **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
- [ ] **Actions** タブ →「Deploy to GitHub Pages」→ **Run workflow** で再実行
- [ ] 完了後、`https://<組織名>.github.io/page.developer-toolbox/` が開くこと
- [ ] `https://<組織名>.github.io/` が 404 であること（アカウント直下のサイトがないこと）
- [ ] **Settings → Environments → github-pages → Deployment branches and tags** が `main` のみになっていること（他のブランチから公開されないように）

## 4. GitHub Actions の権限

**Settings → Actions → General**

- [ ] **Workflow permissions** を **Read repository contents and packages permissions** にする（各ワークフローで必要な権限だけを個別に付与しているため）
- [ ] **Allow GitHub Actions to create and approve pull requests** のチェックを外す
- [ ] **Fork pull request workflows from outside collaborators** を **Require approval for all external contributors** にする。`pull_request` のイベントでは、プルリクエストの側で書き換えたワークフロー（`checks.yml` など）がそのまま動くため。トークンは読み取りだけで Secrets もありませんが、承認しないとランナーで任意のコードを動かせます。一度 PR が取り込まれた人のプルリクエストでも動かないよう、初めての人に限らず毎回承認します。承認する前に、`.github/workflows/`・`package.json`・`package-lock.json`・`scripts/` の変更を確かめてください
- [ ] （表示される場合）**Require actions to be pinned to a full-length commit SHA** を有効にする。このリポジトリのワークフローはすべてSHAで固定済みです

## 5. セキュリティ機能（公開リポジトリは無料）

**Settings → Advanced Security**（または Code security）

- [ ] **Private vulnerability reporting**：有効（`SECURITY.md` の報告窓口。Issue の「脆弱性の報告（非公開）」のリンクも、有効にするまで開けない）
- [ ] **Dependency graph**：有効（`.github/workflows/dependency-review.yml` が使う。無効だと dependency-review のジョブが失敗する）
- [ ] **Dependabot alerts**：有効
- [ ] **Dependabot security updates**：有効
- [ ] **Secret scanning** と **Push protection**：有効（APIキーなどを誤って push しようとしたときに止めてくれる）
- [ ] **Code scanning（CodeQL）**：`.github/workflows/codeql.yml` で設定済み。画面の「Default setup」は**有効にしない**（2つの設定が競合するため）。private リポジトリの間は Code scanning が使えないため、CodeQL のジョブ（`analyze`）は自動でスキップされる

## 6. AI によるレビュー（Codex・Claude Code）

公開リポジトリには誰でもプルリクエストやコメントを送れるため、自分の使用量を消費する AI のレビューは自分だけが起動できる形にします。Codex は新しいリポジトリに連携せず、週1回の定期レビュー（Claude Code）を設定し直します（トリガーはスケジュールのみ）。プルリクエストのたびのレビューは、公開リポジトリなら無料で使える CodeRabbit を新しく設定します。
確認項目は [AI_REVIEW.md の「公開リポジトリ（page.developer-toolbox）へ移したとき」](AI_REVIEW.md#公開リポジトリpagedeveloper-toolboxへ移したとき) にあります（追加料金を防ぐ設定も、同じ文書の先頭で確かめてください）。

## 7. main ブランチの保護

`main` は、プルリクエストからだけ更新します（[CONTRIBUTING.md](../CONTRIBUTING.md) の「コミットとプルリクエスト」）。`main` に入ると公開されるため、CI・CodeQL・Dependency review が通った変更だけを入れます。

**Settings → Rules → Rulesets**（対象：`main`。作成済みの ruleset があれば、それを編集する）

- [ ] **Restrict deletions**（ブランチの削除を禁止）
- [ ] **Block force pushes**（履歴の書き換えを禁止）
- [ ] **Require a pull request before merging**（`main` への直接の push を禁止）。一人で開発する間は **Required approvals** を 0 にする（自分のプルリクエストは自分で承認できないため）
- [ ] **Require status checks to pass** に次のチェックを追加する
  - `check / check`：CI。検査は共通の `checks.yml` を呼ぶため、この名前で表示される
  - `analyze (javascript-typescript)` と `analyze (actions)`：CodeQL。言語ごとの matrix のジョブなので、`analyze` だけの名前のチェックはない
  - `dependency-review`：Dependency review

  チェックの名前は、そのワークフローが一度動いた後でないと候補に出ません。公開リポジトリでプルリクエストを1回作ってから追加してください。
- [ ] 同じ画面の **Require branches to be up to date before merging** を有効にする（古い `main` の上で通った検査のまま、マージしないため）
- [ ] **Bypass list** は空のままにする（管理者の変更も、同じ検査を通してから入れるため）

> Dependabot のプルリクエストも、同じ検査が通ってからマージします。公開（`deploy.yml`）は、`main` に入ったコミットでも同じ検査（`checks.yml`。E2E を含む）をもう一度実行し、通ったときだけ公開します。

## 8. リポジトリの表示と一般設定

安全には関わらない項目ですが、公開先の説明と、プルリクエストの運用をそろえるために設定します。

**トップページの About（右の歯車）**

- [ ] **Description** に、例として「ブラウザ内で完結する開発者向けツール集（17ツール）。入力は外部送信しません。」を書く
- [ ] **Packages** の表示を外し、**Deployments** は表示したままにする（公開先の URL を確かめやすくするため）

**Settings → General**

- [ ] **Features** の **Wikis** と **Projects** を外す（使わない入口を残さないため。文書は `docs/` に置く）
- [ ] **Pull Requests** で **Allow squash merging** だけを残す（`main` の履歴を、プルリクエスト1つにつき1つのコミットにするため）
- [ ] **Automatically delete head branches** を有効にする（マージした作業ブランチを残さないため）

**Releases（公開の節目ごと）**

画面のサイドバーの一番下に「版：v0.1.0（abc1234）」を表示します（`src/buildInfo.ts`）。版は `package.json` の `version`、括弧の中は公開したコミットの先頭7文字です。不具合の報告（Issue のテンプレート）では、この表示を書いてもらいます。

- [ ] 節目にする変更は、先に `package.json` の `version` を上げるプルリクエストを `main` にマージする（最初の節目は、今の `0.1.0` のままでよい）
- [ ] **Releases → Draft a new release** で、`main` に `v<version>` のタグ（最初は `v0.1.0`）を作り、**Generate release notes** で本文を作る。分類は `.github/release.yml` で決めている
- [ ] 公開した画面の版の表示が、作ったタグと同じであることを確かめる

## 9. 公開後の確認

- [ ] 公開URLで開発者ツールの Console にエラー（`Refused to ...` を含む）が出ていないこと
- [ ] Network タブで github.io 以外への通信がないこと
- [ ] **Security** タブで CodeQL の結果に警告がないこと
- [ ] **Actions** タブで CI・CodeQL・Dependency review・Deploy がすべて成功していること（private リポジトリの間は CodeQL の `analyze` と `dependency-review` がスキップと表示される）

## 公開物に含まれるもの

GitHub Pages に公開されるのは `npm run build` が出力した `dist/` の中身だけです（HTML・JavaScript・CSS・favicon）。
ソースコードやテストはリポジトリ（Public）として公開されます。秘密情報は最初からリポジトリに入れないでください。
