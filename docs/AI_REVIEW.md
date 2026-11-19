# AI によるレビューの設定

追加料金を発生させずに AI レビューを設定する手順です。このリポジトリで確認できた稼働状況は [運用記録](records/AI_REVIEW.md) にまとめています。

公開リポジトリには誰でもプルリクエストやコメントを送れます。自分の使用量を消費する AI（Claude・ChatGPT）のレビューは**自分だけが起動できる形**にし、プルリクエストをきっかけに自動で動くのは、費用を自分が負担しない CodeRabbit（公開リポジトリ向けの無料プラン）だけにします。

| 種類 | 担当 | 動く場所 | 結果の出し方 | 費用 |
|---|---|---|---|---|
| 手元でのレビュー（必要なとき） | Claude Code の `/code-review`、Codex の `/review` | 自分の PC | 実行した画面 | 自分の使用量 |
| 定期レビュー（週1回） | Claude Code（スケジュール実行のタスク） | Anthropic のクラウド | GitHub の Issue（ラベル `ai-review`） | 自分の使用量 |
| プルリクエストのたびのレビュー | CodeRabbit（公開リポジトリ向けの無料プラン） | CodeRabbit のクラウド | プルリクエストへのレビューコメント | 無料（公開リポジトリのみ） |

いずれも GitHub Actions を使わないため、Actions の無料枠を消費しません。
レビューの観点は、いずれも [AGENTS.md](../AGENTS.md) の「Code Review Rules」に従います。

## 運用の方針（変わらないこと）

- 追加料金を発生させない。使用量の上限に達したら、購入せずに上限のリセットを待つ。
- API キーを必要とする AI の Action（GitHub Actions 上で動くもの）は使わない。
- レビューは日本語で書く。定期レビューの結果は Issue（ラベル `ai-review`）に、プルリクエストのたびのレビューの結果はプルリクエストのコメントに残す。
- 他の人の操作（プルリクエスト・コメント・Issue）で、自分の使用量を消費したり請求が発生したりする AI を起動させない。他の人の操作で動いてよいのは、費用を自分が負担しない AI（CodeRabbit の公開リポジトリ向けの無料プラン）だけにする。
- AI にはコメントだけを書かせる。AI にコードのコミット・ブランチの作成・プルリクエストの承認をさせない。AI の指摘は参考にとどめ、マージの判断はメンテナーが行う。

## 他の人の操作で費用を発生させないための決まり

- **Codex**：このリポジトリを Codex（chatgpt.com/codex）の GitHub 連携に含めず、**Automatic review** も使わない。`@codex review` を誰が起動できるかを確かめられないため
- **Claude**：`anthropics/claude-code-action` のワークフローを入れない
- **Claude**：プルリクエストごとに動く Code Review の機能を有効にしない
- **Claude**：定期レビューのタスクのトリガーは**スケジュールだけ**にする。GitHub トリガー・API トリガーを追加しない（タスクの実行は、タスクの持ち主の使用量を消費する）
- **CodeRabbit**：公開リポジトリだけで使う（private リポジトリは無料プランの対象外）。有料プランに切り替えず、使った分だけ課金される機能（リポジトリ全体を見る Deep Scan など）を使わない
- **CodeRabbit**：コードを書き込む機能（単体テストの生成・指摘の自動修正・コードの簡略化・CI の修正・衝突の解消など）と承認の機能は、`.coderabbit.yaml` で切っておく。既定で有効な機能は設定の変更として現れないため、[設定のスキーマ](https://coderabbit.ai/integrations/schema.v2.json)が更新されたら、書き込む機能・承認の機能が増えていないか確かめる
- **共通**：コラボレーターを追加せず（書き込み権限があると、AI の連携やタスクを起動できる操作が増えるため）、Actions の Secrets に AI のキーやトークンを登録しない

## 外部サービスの情報と運用記録

この文書の画面名・メニューの場所・無料枠や料金の条件は、各サービスの変更で変わることがあります。設定する前に、下の「参考」の公式の情報で確かめてください。この文書の手順は、リポジトリを移したときにもそのまま使えるように書いています。このリポジトリで実際に確かめた結果（確認日・対象・結果・根拠）は [運用記録](records/AI_REVIEW.md) に残します。

## 追加料金を防ぐ設定（最初に確認）

- [ ] **ChatGPT**：Codex の使用量の上限に達しても、**クレジットを購入しない**（上限はしばらく待つとリセットされる）
- [ ] **ChatGPT**：GitHub Actions 用の `openai/codex-action` は使わない（API キーが必須で、API の料金が別にかかる）
- [ ] **Claude**：[claude.ai/settings/usage](https://claude.ai/settings/usage) で、使用量クレジット（上限を超えた分の従量課金）を**オフのまま**にする。オフなら上限で止まるだけで、請求は発生しない
- [ ] **Claude**：GitHub Actions に API キー（`ANTHROPIC_API_KEY`）や `CLAUDE_CODE_OAUTH_TOKEN` を登録しない
- [ ] **CodeRabbit**：プランが Open source（公開リポジトリ向けの無料プラン）のままで、支払い方法を登録していない
- [ ] **GitHub**：Settings → Billing で、支払い方法を登録していないか、Actions の予算（Budget）が $0 になっていることを確認する（無料枠を超えたら止まり、請求されない）

## 1. 手元でのレビュー

プルリクエストの内容を確かめるときは、そのブランチを手元に取り出し、Claude Code の `/code-review` か Codex の `/review` を実行します。
どちらも [AGENTS.md](../AGENTS.md) を読んでレビューします。他の人のプルリクエストでも、自分で実行するので、他の人の操作では使用量を消費しません。

注意：

- 他の人のプルリクエストのコードは、手元で実行（`npm run setup`・`npm run check` など）する前に中身を確かめてください。依存関係やスクリプトに悪意のあるコードが含まれている可能性があります
- レビューの結果をプルリクエストに残すときは、内容を確かめてから自分でコメントしてください
- 実行は ChatGPT・Claude の使用量を消費します

## 2. 定期レビュー（Claude Code）

前提：Claude Pro 以上

1. [Claude の GitHub App](https://github.com/apps/claude) をインストールし、**Only select repositories** でこのリポジトリだけを選ぶ（リポジトリを取り出し、Issue を登録するために必要）
2. [claude.ai/code/routines](https://claude.ai/code/routines) で新しいタスクを作る
   - **指示文**：下の「定期レビューの指示文」を貼り付け、`<OWNER>/<REPO>` をこのリポジトリ（`0Naoki/page.developer-toolbox`）に置き換える
   - **リポジトリ**：このリポジトリ
   - **環境**：Default（ネットワークは Trusted のままでよい）
   - **トリガー**：スケジュールのみ、毎週1回（例：月曜の朝）。Pro の使用量を節約するため、毎日にはしない。GitHub トリガー・API トリガーは追加しない
   - **コネクタ**（Advanced settings → Connectors）：すべて外す（GitHub への書き込みは組み込みの機能で行うので不要）
3. **Run now** で1回実行し、Issue が登録されること（指摘がなければ登録されないこと）を確認する

注意：

- タスクが登録する Issue は、あなたの GitHub アカウントの名義になります
- **セキュリティの指摘は Issue にならず、実行結果のまとめにだけ書かれます**（公開リポジトリの Issue は誰でも見られるため。[SECURITY.md](../SECURITY.md) の方針）。実行のたびに [claude.ai/code](https://claude.ai/code) の実行履歴を開き、まとめの先頭に「セキュリティの指摘あり」がないか確認してください
- 実行は Claude の使用量を消費します。使用量の上限に達した週は実行されません（使用量クレジットがオフの場合）
- GitHub との連携が切れると最大72時間は実行をスキップし、それを過ぎるとタスクが止まります。止まった場合は、GitHub と再連携してからタスクをオンに戻してください

### 定期レビューの指示文

```text
あなたはこのリポジトリの定期レビュー担当です。コードは変更せず、見つけた問題を GitHub の Issue として登録してください。

## 手順
1. develop ブランチを取り出す（git fetch origin develop && git checkout develop）。develop がなければ既定のブランチのままでよい。
2. AGENTS.md の「Code Review Rules」と CONTRIBUTING.md を読み、その観点でリポジトリ全体をレビューする。直近7日間の変更（git log --since="7 days ago" -p）は特に重点的に見る。
3. 可能なら npm run setup と npm run check を実行し、失敗があれば原因を調べる。実行環境（ネットワークや Node のバージョンなど）が原因の失敗は Issue にしない。
4. 既存の Issue を確認して重複を避ける。閉じた Issue も含め、同じ内容のものは登録しない。100件を超えても漏れないよう、全ページを取得する。
   gh api --paginate "repos/<OWNER>/<REPO>/issues?state=all&labels=ai-review&per_page=100" --jq '.[] | "#\(.number) [\(.state)] \(.title)"'
5. ラベル ai-review がなければ作る。
   gh api repos/<OWNER>/<REPO>/labels -f name=ai-review -f color=8250df -f description="AI による定期レビューの指摘"
6. 指摘を重要度の高い順に、1回あたり最大5件まで Issue として登録する。gh issue create は使えない（GraphQL のため）ので、REST API を使う。本文はファイルに書いてから渡す。
   gh api repos/<OWNER>/<REPO>/issues -f title="..." -F body=@issue-body.md -f "labels[]=ai-review"
7. 最後に、登録した Issue と、登録しなかった指摘（重複・確証がない等）とその理由を短くまとめて終える。セキュリティの指摘（下の「守ること」を参照）は、このまとめにだけ詳しく書く。

## Issue の書き方（日本語）
- タイトル：「[重要度] 何が問題か」（重要度は 高・中・低）
- 本文：概要／場所（ファイルと行。コミット SHA 付きの GitHub のリンク）／再現手順または根拠（具体的な入力・コード・実行結果）／影響／直し方の案／確度（確認済み・推測）

## 守ること
- コードの変更、ブランチの作成や push、プルリクエストの作成はしない。
- 書き込みは、Issue の登録とラベルの作成だけにする（コメントや Issue のクローズはしない）。
- 好みの問題（書き方の違いなど）は指摘しない。
- 問題が見つからなければ Issue は作らない。
- トークンなどの機密情報を Issue に書かない。
- 悪用につながりうるセキュリティの問題（入力内容の外部への送信、HTML やスクリプトの挿入、CSP の抜け道、機密の保存など）は Issue にしない。Issue は公開されることがあり、SECURITY.md の方針で脆弱性は公開の場に書かないことになっているため。手順7のまとめの先頭に「セキュリティの指摘あり」と書き、場所・再現手順・直し方を詳しく書く。
```

## 3. プルリクエストのたびのレビュー（CodeRabbit）

前提：**公開リポジトリ**であること（無料で使えるのは公開リポジトリだけ。private の間はインストールしない）。クレジットカードの登録は不要です。

設定はリポジトリの `.coderabbit.yaml` にあります（日本語でレビューする、コメントだけを書く、`package-lock.json` などをレビューしない）。レビューの観点は、CodeRabbit が [AGENTS.md](../AGENTS.md) を自動で読み取って使います。

1. [CodeRabbit for Open Source](https://www.coderabbit.ai/oss) から GitHub でサインアップし、CodeRabbit の GitHub App をインストールする。**Only select repositories** で公開リポジトリだけを選ぶ
2. CodeRabbit の画面で、プランが Open source（無料）になっていることと、支払い方法を登録していないことを確かめる
3. テスト用のプルリクエスト（`develop` → `main`）を作り、CodeRabbit が日本語でレビューのコメントを付けることを確かめる。リポジトリのスターが10未満の間は自動では動かないので、プルリクエストに `@coderabbitai review` とコメントして頼む

注意：

- 自動のレビューは、既定のブランチ（`main`）へのプルリクエストと、`.coderabbit.yaml` の `reviews.auto_review` で指定した条件に合うものだけが対象です。下書き（draft）のプルリクエストはレビューしません
- **レビューのコメントは公開されます**。定期レビューと違い、セキュリティの指摘だけを非公開に分けることはできません。悪用につながりうる指摘が付いた場合は、修正を優先し、必要なら [SECURITY.md](../SECURITY.md) の方針に沿って GitHub の Security Advisory（非公開）で扱ってください
- 外部の人のプルリクエストが `AGENTS.md`・`.coderabbit.yaml` を変えている場合や、レビューの指示のような文を含んでいる場合は、CodeRabbit の結果をうのみにしないでください。AI のレビューは、プルリクエストに書かれた文に影響されることがあります
- CodeRabbit の GitHub App は、コード・プルリクエスト・Issue・チェック・ワークフローへの書き込みの権限を求めます。書き込む機能は `.coderabbit.yaml` で切っていますが、権限そのものは残ります。公開リポジトリ以外には許可しないでください
- 公開リポジトリ向けの無料プランでは、コードが CodeRabbit の AI の学習に使われることがあると、CodeRabbit のプライバシーポリシーに書かれています（公開リポジトリのコードはもともと誰でも読めるため、このリポジトリでは問題にしない）
- 1時間あたりのレビューの回数に上限があります（スターの数によって変わる）。上限に達したら、有料プランにせず、時間をおいてから頼み直してください

## 公開リポジトリ（page.developer-toolbox）へ移したとき

公開リポジトリは別のリポジトリなので、次を確かめます（決まりは「[他の人の操作で費用を発生させないための決まり](#他の人の操作で費用を発生させないための決まり)」）。

- [ ] Codex：新しいリポジトリは連携しない（GitHub 連携のリポジトリの選択に含めず、Automatic review も使わない）
- [ ] Claude：GitHub App を新しいリポジトリにインストールし、タスクのリポジトリと指示文の `<OWNER>/<REPO>` を変更する。トリガーはスケジュールのみにする
- [ ] CodeRabbit：GitHub App を新しいリポジトリだけにインストールし、プランが Open source（無料）であることを確かめる（「[3. プルリクエストのたびのレビュー（CodeRabbit）](#3-プルリクエストのたびのレビューcoderabbit)」）
- [ ] 古い private リポジトリの連携（Codex・Claude の GitHub App）を外す
- [ ] 新しいリポジトリでレビューの実行を確認し、確認日・対象・根拠を [運用記録](records/AI_REVIEW.md) に記入する

## 参考

- [Review GitHub pull requests with Codex（OpenAI）](https://learn.chatgpt.com/docs/third-party/github)
- [Codex Pricing（OpenAI）](https://developers.openai.com/codex/pricing)
- [Claude Code：スケジュール実行のタスク（Anthropic）](https://code.claude.com/docs/en/routines)
- [Claude Code：クラウド環境と GitHub の操作（Anthropic）](https://code.claude.com/docs/en/cloud-environments)
- [CodeRabbit for Open Source（CodeRabbit）](https://www.coderabbit.ai/oss)
- [CodeRabbit：プランと料金（CodeRabbit）](https://docs.coderabbit.ai/management/plans)
- [CodeRabbit：設定ファイルの項目（CodeRabbit）](https://docs.coderabbit.ai/reference/configuration)
- [CodeRabbit：GitHub との連携と権限（CodeRabbit）](https://docs.coderabbit.ai/platforms/github-com)
- [CodeRabbit：プライバシーポリシー（CodeRabbit）](https://www.coderabbit.ai/privacy-policy)
- [GitHub Actions の課金（GitHub Docs）](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
