# インフラは wrangler の設定ファイルで管理し、Terraform は Go + Cloud Run への置き換えのときに導入する

## Status

accepted

## Context

ADR 0001〜0004 で、基盤は Cloudflare Workers + Durable Objects（Free プラン）、問題セットの保存先は Cloudflare D1、ホストのログインは Better Auth + GitHub OAuth App と決めた。plan.md には「GCP にする場合は IaC として Terraform で書いておきたい」とあり、ADR 0001 では Terraform・GCP の学習を Go + Cloud Run への置き換えのときに回すと決めている。しかし、今の Cloudflare の構成を何で管理するか（wrangler の設定ファイルだけにするか、Terraform も使うか）は決まっていない。

管理の対象になるものは次のとおり。

- Worker、部屋の Durable Object（SQLite のマイグレーションを含む）、D1 データベースとその結びつけ（binding）
- シークレット: GitHub OAuth App の Client Secret、Better Auth の秘密鍵
- GitHub OAuth App（ローカル用と本番用の2つ。ADR 0003）
- ホストの許可リスト（ADR 0003）
- C4 の通知と停止手順

各サービスの仕様は、2026-10-10 時点の公式ドキュメント（context7 経由を含む）と、GitHub の Terraform provider の Issue で確かめた。

## Decision Drivers

- DD1 運用・ランニングコスト（C1〜C4）: Free プランのまま、課金が起きない構成を保つ。止め方がはっきりしている
- DD2 再現性: 環境を作り直すときに、手順が漏れなく分かる。コードで表せるものはコードにし、表せないものは手順書にする
- DD3 二重管理を避ける（M1）: 同じ設定を2か所に書かない。設定の正本が1つで、CI からも同じものを使える
- DD4 セキュリティ: シークレットの値が、リポジトリや IaC の state ファイルに残らない
- DD5 学習価値: plan.md の「Terraform で書いておきたい」に応える。ただし、学びたいのは GCP での Terraform である（ADR 0001）
- DD6 学習コスト・期限: ADR 0001 の40〜80時間の残りに収める

## Considered Options

- K1. wrangler の設定ファイル（`wrangler.jsonc`）だけで管理し、コードで表せないものは README の手順書にする
- K2. Terraform で Cloudflare のリソース（`cloudflare_worker`・D1 など）を管理し、ビルドとデプロイは wrangler で行う
- K3. Terraform ですべてを管理する（ビルドしたコードのアップロードも Terraform で行う）

## Decision Outcome

採用する選択肢: 「K1（wrangler の設定ファイルだけで管理し、コードで表せないものは README の手順書にする）」。Terraform は、Go + Cloud Run への置き換えの ADR で改めて導入を決める。

理由:

- K1 は DD1・DD3・DD4・DD6 で最も良い
  - `wrangler.jsonc` は Worker・Durable Object のマイグレーション・D1 の binding をリポジトリの中に宣言的に書くものなので、それ自体が IaC の役割を果たす。ローカル（`wrangler dev`）・テスト（vitest-pool-workers）・デプロイが同じ設定を読むので、設定の正本が1つで済む
  - wrangler は、ID のない D1 の binding をデプロイのときに自動で作成するか、前のデプロイから引き継げる。D1 を作るためだけに Terraform を使う理由がない
- K2・K3 は、Terraform で管理できないものが多く、管理できるものは wrangler と重なる
  - GitHub OAuth App は、GitHub の API に作成の手段がなく、Terraform の GitHub provider にもリソースがない（integrations/terraform-provider-github の Issue #786 が未解決）。どの案でも手で作る
  - ホストの許可リストは設定ではなくデータなので、どの案でも wrangler のコマンドで扱う
  - シークレットを Terraform で扱うと、値が state ファイルに残りうる。K1 では `wrangler secret put` で Cloudflare にだけ置ける（DD4）
  - Cloudflare の IaC のドキュメントによると、Durable Object の binding とマイグレーションを Terraform で書くと、最初の apply が失敗する。binding をコメントアウトして apply し、戻してもう一度 apply する、という手順が要る。そのうえで「Worker のリソースだけを Terraform で管理し、ビルドとバージョンは wrangler で管理する」ことが勧められており、wrangler との二重管理になる（DD3）
  - K3 は、wrangler が行っているビルド（バンドル）を自分で用意し、`compatibility_date` などの設定を Terraform 側に写す必要がある（DD3・DD6）
- C4 の通知は、どの案でも IaC で管理する必要がない
  - Workers Free は上限を超えると課金されずに止まる。リクエストが1日10万回を超えると Error 1027 になり、D1 は1日の読み書きの上限を超えるとクエリがエラーになる
  - 予算アラートと従量課金の通知は、従量課金のアカウント向けの機能で、Free プランのままなら設定する対象がない
  - D1 は、1日の上限に達したときにメールで知らせる
- DD5 は K2・K3 のほうが満たすが、学びたいのは GCP での Terraform であり、Cloudflare の provider で学べることは一部にとどまる。ADR 0001 で決めたとおり、Go + Cloud Run へ置き換えるときに、自分の手で Terraform を書くほうが学習の目的に合う

## Consequences

- 良い影響: 設定の正本が `wrangler.jsonc` だけになり、ローカル・テスト・CI・本番が同じ設定を読む
- 良い影響: シークレットの値がリポジトリにも state ファイルにも残らない
- 良い影響: Terraform の state の置き場所（リモートのバックエンド）を用意しなくて済む
- 悪い影響: GitHub OAuth App・シークレット・許可リストは手順書で管理するので、手順書が古くなると環境を作り直せない
- 悪い影響: Terraform の学習は、Go + Cloud Run への置き換えまで始まらない
- 悪い影響: Workers のリクエスト数が上限に近づいたことを知らせる公式の通知は、見つけられなかった。D1 も、通知が来るのは上限に達したときで、近づいたときではない。そのため、要件 C4 を「課金が起きうる構成にするときは予算アラートを設定し、無料プランでは上限で止まることを受け入れて、使用量を本番の前後にダッシュボードで確かめる」に書き直した
- 対応事項: Worker・部屋の Durable Object（`new_sqlite_classes` のマイグレーション）・D1 の binding を `wrangler.jsonc` に書く。D1 をデプロイのときに自動で作るか、`wrangler d1 create` で作って ID を書くかは、実装のときに決める
- 対応事項: README に、コードで表せないものの手順をまとめる
  - GitHub OAuth App をローカル用と本番用に作り、コールバック URL を設定する
  - `wrangler secret put` でシークレットを入れる
  - 許可リストにホストを足す・外す（ADR 0003 の対応事項と同じ手順）
  - 止めるときは Worker を削除する（ADR 0001 の対応事項と同じ手順）
- 対応事項: 本番の前後に、ダッシュボードで Workers と D1 の使用量を見る手順を README に書き、O2 のリハーサルで使用量の目安を測る
- 対応事項: 将来 Workers Paid に上げるときは、そのときに予算アラートを設定する
- 対応事項: Go + Cloud Run への置き換えの ADR で、Terraform の導入（state の置き場所、GCP の予算通知、Cloudflare 側も Terraform に寄せるか）を決める
