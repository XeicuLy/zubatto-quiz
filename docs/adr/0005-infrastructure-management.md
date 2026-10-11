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
  - wrangler は、ID のない D1 の binding をデプロイのときに自動で作成し、作った ID を `wrangler.jsonc` に書き戻す（公式ドキュメントの Automatic provisioning）。ダッシュボードや GitHub 連携からデプロイした場合は、ID が設定ファイルに書き戻されない。D1 を作るためだけに Terraform を使う理由がない
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
- 対応事項: エラーのログを7日間残す（O1）方法は、次のとおりにする。料金と保存期間は、2026-10-11 時点の公式ドキュメント（context7 経由）で確かめた
  - Workers Logs を、Free プランのまま使う
    - 2026-11-30 までの Workers Logs は、Free では1日20万件まで・3日しか残らず、O1 を満たさない
    - 2026-12-01 から、Workers Logs は Cloudflare Observability の料金に変わる。Free は、取り込みが1日 0.5 GB まで（アカウント全体で、Workers Traces などと分け合う）で、7日間残る。本番は12月なので、これで O1 を満たす
    - Free で 0.5 GB に達すると、課金はされず、00:00 UTC（日本時間 9:00）まで新しいログを取り込まなくなる。取り込んだログは7日間残る
    - ログの量は、上限よりずっと少ない。部屋の DO は Hibernation API を使うので、ログが出るのは「入口の要求」「回答者やホストからのメッセージ」「alarm」の呼び出しごとに1件と、自分で出したログだけで、送信や ping の自動応答では出ない。本番（20名・20問）で数千件、O2 のリハーサル（5部屋 × 50接続）でも数万件の見込みで、1件1 KB としても数十 MB にとどまる。実際の量は、O2 のリハーサルで使用量とあわせて測る
    - 選ばなかった方法: 有料の Workers Paid（月5ドル）は、C1 の月500円程度を超える。エラーを D1 や部屋の DO に書くと、書き込みと見る手段のコードが増え、D1 が落ちたときのエラーも残せない。O1 を3日に緩めるのは、12月から7日残るので理由がない
  - 予備として、本番中は手元で `wrangler tail` の出力をファイルに保存する。12月からの料金の変更が遅れたときや、アカウントの上限で取り込みが止まったときに備える。費用はかからない
    - `wrangler tail` は、Worker から呼んだ Durable Object のログも流す。ただし、混んでいると間引かれる（sampling mode）。本番の量では間引かれない見込み
  - ログに出すものと出さないもの（ADR 0004・S5）
    - `console.error` などに出すのは、`{ event: 'join_rejected', roomId, code }` のような、決まったキーの値だけにする。回答者は `participantId` で表す
    - 再接続用の秘密とそのハッシュ、受け取ったメッセージの本文、回答者の名前、Cookie やセッションの値は出さない。メッセージの本文には、`join`・`resume` の秘密と名前が入るため
    - メッセージの検証に失敗したときも、受け取った値は出さず、エラーの種類と場所（どのキーか）だけを出す
    - 呼び出しごとのログ（invocation logs）は、`fetch` では「`<Method> <URL>`」、WebSocket ではイベントの種類（`message` など）を残す。メッセージの本文は残らない。リクエストのヘッダーのうち、`cookie` と、名前に `auth`・`token`・`secret` などを含むものは、値が `REDACTED` に置き換わる
    - URL のクエリは、既定ではそのまま残る。GitHub のログインから戻る URL（`/api/auth/callback/github?code=...&state=...`）の値が残らないよう、`redact_query_string` を有効にする
  - T11（#15）で、`apps/api/wrangler.jsonc` に次の設定を書く。T24（#28）で、`apps/web/wrangler.jsonc` にも同じ設定を書く。画面の Worker も `/api/*` を転送するので、同じ URL がログに残るため。Traces は使わない（上限を分け合うため）

    ```jsonc
    "observability": {
      "enabled": true,
      "redact_query_string": true,
      "logs": { "invocation_logs": true, "head_sampling_rate": 1 },
    },
    ```

  - T35（#39）の本番の手順に、次のことを書く
    - 本番の前に、ダッシュボードの Billable Usage かドキュメントで、Free の保存期間が7日になったことを確かめる。3日のままなら、手元のファイルを7日以上残す
    - 本番の始まりから終わりまで、`pnpm wrangler tail <API の Worker の名前> --format json > logs/<日付>-api.jsonl` を動かしておく。`logs/` は `.gitignore` に入れる
    - 手元のファイルには、ヘッダーに含まれる IP アドレスなども入るので、リポジトリに入れず、人に渡さない。エラーを確かめ終えたら消す
    - 本番のあと7日以内に、ダッシュボードの Workers Logs でエラー（`console.error` と例外）を確かめる
  - T37（#41）の O2 のリハーサルで、次のことも確かめる
    - Workers Logs の件数（または取り込んだ量）
    - 部屋の DO の `webSocketMessage` で出したログが、接続が閉じる前に `wrangler tail` に流れること。ドキュメントには「WebSocket のイベントの中の `console.log` は、接続が閉じるまで `wrangler tail` に出ない」とある。これは Hibernation API を使わない WebSocket についての注意と思われるが、確かめる。閉じるまで出ないなら、本番のあとに Workers Logs で確かめる手順を主にする
