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
  - `wrangler.jsonc` は Worker・Durable Object のマイグレーション・D1 の binding をリポジトリの中に宣言的に書くものなので、それ自体が IaC の役割を果たす。ローカル（`wrangler dev`）・テスト（vitest-plugin）・デプロイが同じ設定を読むので、設定の正本が1つで済む
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
- 良い影響: D1 の ID がリポジトリに入らないので、D1 を作り直しても設定ファイルを書き換えなくて済む
- 悪い影響: CI からデプロイするので、Cloudflare の API トークンを GitHub に置く。漏れると、このアカウントの Worker と D1 を書き換えられる
- 悪い影響: Workers のリクエスト数が上限に近づいたことを知らせる公式の通知は、見つけられなかった。D1 も、通知が来るのは上限に達したときで、近づいたときではない。そのため、要件 C4 を「課金が起きうる構成にするときは予算アラートを設定し、無料プランでは上限で止まることを受け入れて、使用量を本番の前後にダッシュボードで確かめる」に書き直した
- 対応事項: Worker・部屋の Durable Object（`new_sqlite_classes` のマイグレーション）・D1 の binding を `wrangler.jsonc` に書く。D1 の binding は、API の Worker の `apps/api/wrangler.jsonc` にだけ書く（ADR 0006）
  - テストには vitest-plugin（`@cloudflare/vitest-plugin`）を使う。この ADR を書いたときの名前は vitest-pool-workers（`@cloudflare/vitest-pool-workers`）だったが、名前が変わり、前の名前のパッケージは更新されなくなった（2026-10-11 に npm で確かめた）。ADR 0002〜0006 の本文も、新しい名前に直した
- 対応事項: D1 の作り方と、本番のデプロイ・マイグレーションの仕方は、次のとおりにする。wrangler の仕様は、2026-10-11 時点の公式ドキュメント（context7 経由を含む）と、wrangler のソース（4.149.0）で確かめた
  - D1 の binding には名前だけを書き、`database_id` は書かない。T11 では `d1_databases: [{ binding: 'DB', database_name: 'zubakui' }]` と書く。`migrations_dir` は、T12 で drizzle の出力先に合わせて足す
    - wrangler は、ID のない D1 の binding を、デプロイのたびに次の順で結びつける。デプロイ済みの Worker に同じ binding があれば、それを引き継ぐ。なければ、同じ名前の D1 があればそれにつなぐ。それもなければ、その名前で D1 を作る。そのため、ID が書き戻されなくても、デプロイのたびに D1 が増えることはない
    - `wrangler d1 migrations apply DB --remote` などの D1 のコマンドも、ID がなければ名前で D1 を探す（wrangler 4.102.0 から）。名前だけで足りるので、ID をリポジトリに持たない
    - wrangler は 4.113.0 以上を使う。Automatic provisioning は、この版で試験的な機能ではなくなった
    - `database_name` は変えない。変えると、wrangler は前の D1 から離れ、新しい空の D1 を作ってしまう
  - wrangler.jsonc に ID が書き戻されても、コミットしない。ローカルの D1 は、`database_id` があればその ID で、なければ binding の名前（`DB`）で見分けられる。ID を書き足すと、ローカルの D1 が別の空のものに替わってしまう
  - ローカル（`vite dev`）とテスト（vitest-plugin）は、ID に関係なくローカルの D1 を使う。どちらも `DB` という名前のローカルの D1 になり、Cloudflare のアカウントは要らない。この決定でテストは変わらない
  - 本番の D1 は、初回だけ手元で `wrangler d1 create zubakui --location apac` を実行して作る
    - マイグレーションはデプロイの前に当てる（次の項目）ので、初回も D1 が先にないといけない。許可リストに自分を入れるときも、D1 とテーブルが要る。どのみち初回は手元の手順が要るので、そこで作る
    - 位置のヒント（`--location`）を付けないと、D1 は作る要求を出した場所の近くに置かれる。CI のデプロイで自動で作ると、CI のマシンがある場所（米国など）に置かれうる。位置をあとから変えられるとは、ドキュメントに書かれていない
    - 設定ファイルに足すかを聞かれたら断る。`--update-config` も付けない
    - 自動で作る仕組みは、初回の手順を飛ばしたときの備えにはならない。D1 がないと、workflow の最初のマイグレーションが「D1 が見つからないので `wrangler d1 create` を実行して」というエラーで止まり、D1 を自動で作る API の Worker のデプロイまで進まない（wrangler 4.149.0 のソースで確かめた）。D1 を作り直すときも、同じコマンドで先に作る
  - 本番のデプロイとマイグレーションは、GitHub Actions の workflow から行う
    - 手で動かしたとき（`workflow_dispatch`）だけ動く workflow にする。main にマージしてもデプロイしない。本番中は API の Worker をデプロイしない決まり（ADR 0006）を、マージで破らないため
    - 動かすときに「画面だけ」か「API と画面」かを選ぶ。「API と画面」では、マイグレーション（`wrangler d1 migrations apply DB --remote`）→ API の Worker → 画面の Worker の順に行う。Service binding の相手が先にないといけないので、API の Worker を先にする（ADR 0006）
    - マイグレーションは、古いコードのままでも動くもの（テーブルや列を足すもの）にする。マイグレーションを当ててから API の Worker をデプロイし終えるまでは、古いコードが新しいスキーマで動くため
    - 手元からはデプロイしない。デプロイの手順が workflow のファイルに残り（DD2）、手元の wrangler.jsonc に ID が書き戻されることもない
    - Cloudflare の API トークンとアカウント ID は、GitHub の Environment（`production`）の secret に置き、デプロイの job だけが読めるようにする。トークンは「Edit Cloudflare Workers」のテンプレートに D1 の Edit を足して作り、このアカウントだけに絞る。テンプレートには D1 の権限が入っていない
    - アプリのシークレット（`wrangler secret put`）は、これまでどおり手元で入れる。値を CI に置かない（DD4）
    - PR ごとに lint・型チェック・テストを走らせる CI（T8）とは、別の workflow にする。デプロイの workflow は T38（#53）で作る
- 対応事項: README に、コードで表せないものの手順をまとめる
  - GitHub OAuth App をローカル用と本番用に作り、コールバック URL を設定する
  - `wrangler secret put` でシークレットを入れる
  - 許可リストにホストを足す・外す（ADR 0003 の対応事項と同じ手順）
  - 止めるときは Worker を削除する（ADR 0001 の対応事項と同じ手順）
    - Worker を削除しても D1 は残る。Free プランでは残しても課金されない。すべて消すときは `wrangler d1 delete zubakui` も実行する
    - デプロイをやめるときは、Cloudflare の API トークンも削除する
  - 本番の D1 を `wrangler d1 create zubakui --location apac` で作る（初回だけ）
  - Cloudflare の API トークンを作り、アカウント ID とあわせて、GitHub の Environment（`production`）の secret に入れる
  - デプロイの workflow の動かし方。本番中は「API と画面」を選ばない
  - 初めて環境を作るときの順番: D1 を作る → シークレットを入れる → workflow を「API と画面」で動かす（マイグレーションも当たる）→ 許可リストに自分を入れる
  - ローカルの D1 にマイグレーションを当てる。`vite dev` は画面の Worker（apps/web）の側にローカルのデータを置くので、`wrangler d1 migrations apply DB --local` の `--persist-to` をそこに合わせる。T12 で確かめたパスは `../web/.wrangler/state`（apps/api から見たもの）で、`pnpm --filter @zubatto-quiz/api run db:migrate:local` で当てる。`vite dev` と wrangler は、どちらもローカルの D1 を binding の名前（`DB`）で見分けるので、同じ D1 になる
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
    - 本番の前に、ダッシュボードの Billable Usage かドキュメントで、Free の保存期間が7日になったことを確かめる
    - 本番の始まりから終わりまで、API と画面の Worker の `wrangler tail` を、別々のファイルに保存しておく。`logs/` は `.gitignore` に入れる
      - 先に `mkdir -p logs` を実行する。`>` はファイルを作るが、`logs/` は作らないため
      - `pnpm wrangler tail <API の Worker の名前> --format json > logs/<日付>-api.jsonl`
      - `pnpm wrangler tail <画面の Worker の名前> --format json > logs/<日付>-web.jsonl`。画面の Worker で起きたエラー（`/api/*` を転送できなかったときなど）は、API の Worker の tail には出ないため
    - 手元のファイルには、ヘッダーに含まれる IP アドレスなども入るので、リポジトリに入れず、人に渡さない。本番のログが Workers Logs に7日間残るなら、エラーを確かめ終えたら消す。保存期間が3日のままだったときや、上限で取り込みが止まったときは、本番が終わってから7日たつまで消さない
    - 本番のあと7日以内に、ダッシュボードの Workers Logs でエラー（`console.error` と例外）を確かめる
  - T37（#41）の O2 のリハーサルで、次のことも確かめる
    - Workers Logs の件数（または取り込んだ量）
    - 部屋の DO の `webSocketMessage` で出したログが、接続が閉じる前に `wrangler tail` に流れること。ドキュメントには「WebSocket のイベントの中の `console.log` は、接続が閉じるまで `wrangler tail` に出ない」とある。これは Hibernation API を使わない WebSocket についての注意と思われるが、確かめる。閉じるまで出ないなら、本番のあとに Workers Logs で確かめる手順を主にする
