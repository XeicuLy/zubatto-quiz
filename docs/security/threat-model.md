# 脅威モデル

ズバクイが何を守り、誰から、どの経路で守るのか。守りをコードとテストのどこで確かめているのか。守らずに受け入れたものは何か。これらを1か所にまとめる。

2026-11-16 に、アプリ全体（`apps/api`、部屋の DO、`apps/web`、`packages/*`、CI/CD、Cloudflare の設定と運用）を攻撃する側の目線で点検した結果（#341）をもとに書いた。点検では、文書に書いた約束（S1〜S3、WebSocket の入口の Origin の確認、許可リストの確かめ直し、テスト用のコードを本番に入れないこと）は守れていた。弱い所は、どの ADR も扱っていない所にあった。

脆弱性を見つけたときの報告の窓口は [SECURITY.md](../../SECURITY.md) にある。

## 守るもの

| もの                                       | なぜ守るか                                                                                                                     | 要件・ADR                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| ホストのセッション                         | 奪われると、そのホストの問題セット（正解を含む）を読み書きでき、部屋を進行できる。管理者のセッションなら、ホストを足し、外せる | S1、[ADR 0003](../adr/0003-host-identification-and-host-connection.md)、ADR 0013 |
| 回答者の秘密                               | localStorage に置き、つなぎ直しに使う。持ち出されると、その回答者として回答できる                                              | S4、[ADR 0004](../adr/0004-player-identification-and-reconnection.md)            |
| 締切の前の正解                             | 届けば、開発者ツールで正解を見て答えられる                                                                                     | S2、[ADR 0002](../adr/0002-question-set-storage-and-room-handoff.md)             |
| 部屋 ID                                    | 部屋の URL そのもので、知っていれば誰でも参加できる。推測できず、漏れないことが参加の鍵になる                                  | S3                                                                               |
| ホストの個人情報                           | D1 に持つのは GitHub の ID と login だけ。前からある行に残る email・トークン・IP などは #347 で消す                            | S5、[ADR 0016](../adr/0016-do-not-keep-host-personal-data.md)                    |
| 無料枠（リクエスト・DO・D1・Workers Logs） | 使い切られると、その日の残りは画面も API も止まる。アカウント全体で分け合う                                                    | C1、C4、[stop-and-usage.md](../runbooks/stop-and-usage.md#無料プランの上限)      |

回答者の名前と回答は、自分で入力したものだけを扱う（S5）。公開の場で使うことを前提に、秘密としては扱わない。

## 攻撃者

| 攻撃者                     | できること                                                                                          | 主に狙うもの                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 外の誰でも                 | 公開の URL へ要求を送る。ログインを試す。別のサイトからホストのブラウザに要求を送らせる             | ホストのセッション、部屋 ID の推測、無料枠       |
| 部屋 ID を知る参加者       | 回答者用の入口につなぎ、決まった形のメッセージを何でも送る。何人分でも参加する。開発者ツールを使う  | 締切の前の正解、他人の名前での回答、得点、無料枠 |
| ホスト                     | 自分の問題セットと部屋を操作する。題名・問題文・選択肢を書く                                        | 他のホストの問題セットと部屋                     |
| 外されたホスト             | 外される前の Cookie や、開いたままの WebSocket を持っている                                         | 外されたあとも操作を続けること                   |
| 依存や CI を汚す者         | npm の依存、GitHub Actions の action、ツールの配布物に手を入れる。PR の題名やブランチ名に式を入れる | CI の中のトークン、本番へのデプロイ              |
| 開発者のアカウントを奪う者 | 開発者の GitHub・Cloudflare のアカウントや手元の端末を使う                                          | すべて（本番の承認、secret、D1 の中身）          |

## 経路

| 経路                                  | 入口                                                                                                                         | 主な攻撃者                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| HTTP API                              | 画面の Worker が `/api/*` を Service binding で API の Worker へ転送する（ADR 0006）                                         | 外の誰でも、ホスト           |
| ログイン                              | `/api/auth/*`（Better Auth と GitHub の OAuth）                                                                              | 外の誰でも                   |
| 部屋の WebSocket                      | `/api/rooms/:roomId/ws/host` と `/ws/play`。メッセージは `packages/protocol` の形                                            | 部屋 ID を知る参加者、ホスト |
| 画面                                  | 画面の Worker が配る静的ファイル。利用者の入力（名前・問題文）を描く                                                         | 部屋 ID を知る参加者、ホスト |
| 外への問い合わせ                      | ホストを足すときの `api.github.com/users/`                                                                                   | 外の誰でも（応答の中身）     |
| CI とデプロイ                         | `.github/workflows/`、Dependabot の PR、npm と action とツールの取得、`production` の Environment                            | 依存や CI を汚す者           |
| ログ                                  | Workers Logs と `wrangler tail`。URL の経路と接続元の IP が残る（[logs.md](../runbooks/logs.md#ログに残るもの残らないもの)） | 開発者のアカウントを奪う者   |
| Cloudflare と GitHub のダッシュボード | secret、D1、ルールセット、Environment の承認者                                                                               | 開発者のアカウントを奪う者   |

## 確かめた守り

どの行も、守っているファイルと、それを確かめるテストを指す。指す先のファイルが消えたり名前が変わったりすると、`tools/docs-check` の `links.test.ts` が落ちる。行にリンクが無いと `threat-model.test.ts` が落ちる。

### ホストの認証と HTTP API

| 守り                                                                                                             | どこで                                                                                                                       | 確かめるテスト                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 許可リストの外の GitHub ユーザーは、`user` の行を書く前に断り、セッションを作る前にも確かめる                    | [create-auth.ts](../../apps/api/src/auth/create-auth.ts)、[allowlist.ts](../../apps/api/src/auth/allowlist.ts)               | [create-auth.test.ts](../../apps/api/src/auth/create-auth.test.ts)、[allowlist.test.ts](../../apps/api/src/auth/allowlist.test.ts)                                                                                     |
| 要求のたびに許可リストを確かめ直し、行より前に作られたセッションを通さない（足し直しても古い Cookie は戻らない） | [require-host.ts](../../apps/api/src/auth/require-host.ts)                                                                   | [require-host.test.ts](../../apps/api/src/auth/require-host.test.ts)                                                                                                                                                   |
| 管理者だけの経路は、要求のたびに D1 の管理者の印を読む。経路を足したら例を足さないと落ちる                       | [require-admin.ts](../../apps/api/src/auth/require-admin.ts)、[admin-hosts.ts](../../apps/api/src/routes/admin-hosts.ts)     | [require-admin.test.ts](../../apps/api/src/auth/require-admin.test.ts)、[admin-routes.test.ts](../../apps/api/test/admin-routes.test.ts)                                                                               |
| 状態を変える Cookie の経路は、`csrf()` で別のオリジンからの要求を断る                                            | [question-sets.ts](../../apps/api/src/routes/question-sets.ts)、[rooms.ts](../../apps/api/src/routes/rooms.ts)               | [question-sets.test.ts](../../apps/api/src/routes/question-sets.test.ts)、[rooms.test.ts](../../apps/api/src/routes/rooms.test.ts)                                                                                     |
| 他のホストの問題セットと部屋は、ないものと同じ 404・4404 に見える（S1）                                          | [repository.ts](../../apps/api/src/question-sets/repository.ts)、[room-do.ts](../../apps/api/src/room/room-do.ts)            | [question-sets.test.ts](../../apps/api/src/routes/question-sets.test.ts)、[room-do.test.ts](../../apps/api/src/room/room-do.test.ts)、[security.contract.test.ts](../../tools/contract/test/security.contract.test.ts) |
| `/api/auth/*` の本文を、Better Auth が読む前に 4KB で止める                                                      | [index.ts](../../apps/api/src/index.ts)                                                                                      | [body-limit.test.ts](../../apps/api/src/auth/body-limit.test.ts)                                                                                                                                                       |
| ログインで email・本名・アバター・トークン・IP・User-Agent を保存せず、GitHub に scope も求めない                | [host-data-policy.ts](../../apps/api/src/auth/host-data-policy.ts)、[create-auth.ts](../../apps/api/src/auth/create-auth.ts) | [create-auth.test.ts](../../apps/api/src/auth/create-auth.test.ts)、[host-data-policy.test.ts](../../apps/api/src/auth/host-data-policy.test.ts)                                                                       |
| ログイン Cookie は HttpOnly・SameSite=Lax で、7日で切れる                                                        | [create-auth.ts](../../apps/api/src/auth/create-auth.ts)                                                                     | [create-auth.test.ts](../../apps/api/src/auth/create-auth.test.ts)                                                                                                                                                     |
| 外への問い合わせは `https://api.github.com/users/` だけで、名前の形を確かめてから送り、待つ時間を区切る          | [lookup-user.ts](../../apps/api/src/github/lookup-user.ts)                                                                   | [lookup-user.test.ts](../../apps/api/src/github/lookup-user.test.ts)                                                                                                                                                   |
| ホストを外すときは、許可リストの行とセッションを1つの batch で消す。管理者の行は外せない                         | [repository.ts](../../apps/api/src/hosts/repository.ts)                                                                      | [repository.test.ts](../../apps/api/src/hosts/repository.test.ts)                                                                                                                                                      |
| 本番のバンドルに、テスト用のログインと Swagger UI を入れない                                                     | [e2e-entry.ts](../../apps/api/test/e2e-entry.ts)、[index.ts](../../apps/api/src/index.ts)                                    | [production-bundle.test.ts](../../apps/api/test/bundle/production-bundle.test.ts)                                                                                                                                      |

### 部屋と WebSocket

| 守り                                                                                          | どこで                                                                                                                     | 確かめるテスト                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebSocket の入口は、Cookie を読む前に Origin を確かめる                                       | [ws.ts](../../apps/api/src/routes/ws.ts)                                                                                   | [ws.test.ts](../../apps/api/src/routes/ws.test.ts)                                                                                                                                                                                                   |
| ブラウザの要求を DO へそのまま渡さない。持ち主のヘッダーを自分で付けてもホストにはなれない    | [connections.ts](../../apps/api/src/room/connections.ts)                                                                   | [ws.test.ts](../../apps/api/src/routes/ws.test.ts)                                                                                                                                                                                                   |
| 部屋 ID は `newUniqueId()` の64桁の16進で、推測できない（S3）                                 | [rooms.ts](../../apps/api/src/routes/rooms.ts)                                                                             | [rooms.test.ts](../../apps/api/src/routes/rooms.test.ts)                                                                                                                                                                                             |
| 正解は締切まで DO の外に出ない。ホストにも、締切の前は分布を送らない（S2）                    | [send.ts](../../apps/api/src/room/send.ts)、[results.ts](../../apps/api/src/room/results.ts)                               | [close-question.test.ts](../../apps/api/src/room/handlers/close-question.test.ts)、[host-commands.test.ts](../../apps/api/src/room/handlers/host-commands.test.ts)、[security.contract.test.ts](../../tools/contract/test/security.contract.test.ts) |
| 進行の操作は、ホスト用の入口の接続からだけ、決まった順番で受け付ける                          | [host-commands.ts](../../apps/api/src/room/handlers/host-commands.ts)                                                      | [host-commands.test.ts](../../apps/api/src/room/handlers/host-commands.test.ts)                                                                                                                                                                      |
| 回答者の秘密は SHA-256 だけを持ち、`timingSafeEqual` で比べる。秘密は応答にもログにも出さない | [resume.ts](../../apps/api/src/room/handlers/resume.ts)、[token-hash.ts](../../apps/api/src/room/token-hash.ts)            | [resume.test.ts](../../apps/api/src/room/handlers/resume.test.ts)、[join.test.ts](../../apps/api/src/room/handlers/join.test.ts)                                                                                                                     |
| 回答は接続の attachment の回答者として記録し、1問に1回だけ受け付ける（S4）                    | [answer.ts](../../apps/api/src/room/handlers/answer.ts)、[schema.ts](../../apps/api/src/room/schema.ts)                    | [answer.test.ts](../../apps/api/src/room/handlers/answer.test.ts)、[schema.test.ts](../../apps/api/src/room/schema.test.ts)                                                                                                                          |
| 接続は回答者100本・ホスト5本まで。join も resume も送らない接続は10秒で閉じる                 | [connections.ts](../../apps/api/src/room/connections.ts)、[pending-timeout.ts](../../apps/api/src/room/pending-timeout.ts) | [connections.test.ts](../../apps/api/src/room/connections.test.ts)、[pending-timeout.test.ts](../../apps/api/src/room/pending-timeout.test.ts)                                                                                                       |
| 1部屋の参加は50名まで。同時に来ても超えない（SC1）                                            | [join.ts](../../apps/api/src/room/handlers/join.ts)                                                                        | [join.test.ts](../../apps/api/src/room/handlers/join.test.ts)                                                                                                                                                                                        |
| 同じ回答者が別の接続でつなぐと、古い接続を閉じる（ADR 0004 の X1）                            | [replace-connection.ts](../../apps/api/src/room/replace-connection.ts)                                                     | [replace-connection.test.ts](../../apps/api/src/room/replace-connection.test.ts)                                                                                                                                                                     |

### 画面

| 守り                                                                                                           | どこで                                                                               | 確かめるテスト                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP の `script-src 'self'` を付け、`index.html` にインラインのスクリプト・スタイル・イベントハンドラを置かない | [\_headers](../../apps/web/public/_headers)、[index.html](../../apps/web/index.html) | [static-files.test.ts](../../apps/web/test/static-files.test.ts)、[csp.spec.ts](../../e2e/csp.spec.ts)                                                                                                                                    |
| 利用者の入力（名前・選択肢）を文字のまま描く。`innerHTML` のような API を lint で断る                          | [.oxlintrc.json](../../.oxlintrc.json)                                               | [JoinForm.test.tsx](../../apps/web/src/features/player/JoinForm.test.tsx)、[AnswerButtons.test.tsx](../../apps/web/src/features/player/AnswerButtons.test.tsx)、[HostLobby.test.tsx](../../apps/web/src/features/host/HostLobby.test.tsx) |
| 受け取ったメッセージは protocol の `serverMessageSchema` を通し、仕様にない項目を取り除く                      | [client.ts](../../apps/web/src/realtime/client.ts)                                   | [client.test.ts](../../apps/web/src/realtime/client.test.ts)                                                                                                                                                                              |
| 回答者の秘密は、端末で `crypto.getRandomValues` の32バイトから作り、部屋ごとに保存する                         | [token-storage.ts](../../apps/web/src/features/player/token-storage.ts)              | [token-storage.test.ts](../../apps/web/src/features/player/token-storage.test.ts)                                                                                                                                                         |

詳しくは [frontend.md の「XSS を防ぐ」](../architecture/frontend.md#xss-を防ぐ)にある。

### CI とデプロイ

| 守り                                                                                                        | どこで                                                                                             | 確かめるテスト                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| main は必須のチェックが通らないとマージできず、管理者も例外にしない                                         | [main-ruleset.json](../runbooks/main-ruleset.json)                                                 | [main-ruleset.test.ts](../../tools/docs-check/test/main-ruleset.test.ts)                                                                                     |
| `v*` のタグを作れるのは、release の App だけ                                                                | [release-tag-ruleset.json](../runbooks/release-tag-ruleset.json)                                   | [release-tag-ruleset.test.ts](../../tools/docs-check/test/release-tag-ruleset.test.ts)                                                                       |
| action を `actions.lock` で固定し、`pnpm install` より前に `--verify` で確かめる                            | [actions.lock](../../.github/workflows/actions.lock)、[ci.yaml](../../.github/workflows/ci.yaml)   | [ci-workflow.test.ts](../../tools/docs-check/test/ci-workflow.test.ts)                                                                                       |
| `run:` に `github.event.*` と `github.head_ref` を `${{ }}` で埋め込まない                                  | [ci.yaml](../../.github/workflows/ci.yaml)、[pr-title.yaml](../../.github/workflows/pr-title.yaml) | [ci-workflow.test.ts](../../tools/docs-check/test/ci-workflow.test.ts)                                                                                       |
| `deploy` は、ほかの job が書き込めるキャッシュを読まない。mise 本体の版を固定する                           | [deploy.yaml](../../.github/workflows/deploy.yaml)                                                 | [ci-workflow.test.ts](../../tools/docs-check/test/ci-workflow.test.ts)                                                                                       |
| Cloudflare の secret を読むのは、`production` の承認を待つ `deploy` だけ。PR の CI は secret を読まない     | [deploy.yaml](../../.github/workflows/deploy.yaml)                                                 | [deploy-workflow.test.ts](../../tools/docs-check/test/deploy-workflow.test.ts)                                                                               |
| `GITHUB_TOKEN` に書き込みを渡さない。App の token は `release` job の1つの step にだけ渡す                  | [deploy.yaml](../../.github/workflows/deploy.yaml)                                                 | [release-workflow.test.ts](../../tools/docs-check/test/release-workflow.test.ts)                                                                             |
| npm の依存は完全に固定し、Dependabot は公開から3日（major は7日）たった版だけを PR にする。自動マージしない | [pnpm-workspace.yaml](../../pnpm-workspace.yaml)、[dependabot.yml](../../.github/dependabot.yml)   | [pnpm-exact-versions.test.ts](../../tools/docs-check/test/pnpm-exact-versions.test.ts)、[dependabot.test.ts](../../tools/docs-check/test/dependabot.test.ts) |

## これから入れる守り

#341 の子 Issue で入れる。入ったら、その行を「確かめた守り」の表へ移し、ファイルとテストへのリンクを付ける。

| 守り                                                                                    | Issue      | 所見                        |
| --------------------------------------------------------------------------------------- | ---------- | --------------------------- |
| 前からあるホストの行を、ログインと同じ保存の規則で1回書き換える                         | #347       | A1、A7                      |
| ホストを外したら、`user` の行ごと消す（account・問題セットも消える）                    | #346       | A2                          |
| 外したホストの、開いたままの WebSocket を切る                                           | #359       | Z5                          |
| API の入口で、ログインの開始・部屋への接続・書き込みを絞る                              | #348、#356 | S-01、Z3                    |
| API の守り（ヘッダー、非 GET の Origin の確認、本文の上限）を1か所にまとめる            | #349       | A5、A11、A12、A13、Z8、S-07 |
| Better Auth の設定を、実行環境の既定値に頼らず明示する                                  | #350       | A3、A4、A8、A15             |
| ホストごとの問題セットの数と部屋の数に上限を設ける                                      | #351、#361 | A6                          |
| 回答時間に、出題の時刻から計算した下限を設ける（`0` と申告しても満点にならない）        | #352       | Z1                          |
| 見えない名前と、重ねた結合文字を断る                                                    | #353       | Z7                          |
| 不正なメッセージを送り続ける接続を切る                                                  | #354       | Z4                          |
| デプロイのトークンを wrangler だけに渡し、E2E の D1 を本番と分ける                      | #355       | S-02、S-08、A9              |
| すべての `${{ }}` を `run:` から禁じ、依存の既知の脆弱性を定期的に調べる                | #357       | S-03、S-09、S-10            |
| バックアップ・インシデント・secret のローテーション・ダッシュボードの設定の確認の手順書 | #358       | S-04、S-05、S-06、S-12      |
| 部屋に寿命を設け、終わった部屋のデータを片づける                                        | #360       | Z6                          |
| 部屋が終わったら、回答者の秘密を端末から消す                                            | #362       | Z9                          |

## 受け入れたリスク

守らない、または守り切れないと決めたもの。決めた理由と、見直す合図を書く。

### Workers Free の1日10万リクエストの枠

外の誰でも、要求を送り続ければ、その日の Workers のリクエストの枠（アカウント全体で1日100,000、[stop-and-usage.md](../runbooks/stop-and-usage.md#1日ごとの上限)）を使い切れる。使い切ると、日本時間 9:00 まで画面も API も止まる。

- Worker が断った要求も、1リクエストに数えられる。Worker の前で止めるには、Cloudflare の WAF のレート制限のようにゾーン（自分のドメイン）が要る。ドメインを買わないことは [ADR 0006](../adr/0006-spa-and-api-worker-layout.md) の判断で、これは変えない
- #356 で入れる絞り込みは、D1 や DO の枠と、ログインの開始を守るためのもので、Workers のリクエストの枠は守れない。また、Rate Limiting binding は本番の拠点では概算で、上限よりかなり多く通る（#341 のコメント、2026-11-20 に確かめた）。上限は桁を抑えるための値で、ちょうどの回数で止まることはあてにしない
- 課金はされずに止まるだけ（C4）。本番の最中に止められたら、[stop-and-usage.md](../runbooks/stop-and-usage.md#止める) の手順で止め、翌日にやり直す

見直す合図: ドメインを持つことにしたとき、または有料プランに移るとき。

### 本番の承認者が自分自身

`production` の Environment の Required reviewers は開発者1人で、デプロイを始める人と承認する人が同じになる（O3、[ADR 0009](../adr/0009-release-versioning-and-tagging.md)）。開発者の GitHub のアカウントを奪われると、承認も通される。

- 運用するのは開発者だけ（O3）で、2人目の承認者はいない。承認は「誤って出さない」ための確認で、アカウントを奪われたときの守りにはならない
- アカウントを奪われることへの守りは、GitHub と Cloudflare のアカウント側の守り（2要素認証など）に頼る。奪われたときの手順は #358 で書く

見直す合図: 運用に2人目が加わったとき。

### 名前を変えた複数の参加と、見た目の似た名前

部屋 ID を知っていれば、名前を変えて何人でも参加できる（50名まで）。偽の名前で枠を埋める、選択肢ごとに1人ずつ答えて誰かを必ず正解させる、荒らす名前を投影の画面に出す、ができる。見た目は同じで別の文字の名前（全角と半角、似た形の別の文字）も、別の名前として入れる。

- 同じ人が別の回答者としてもう一度参加することの防止は、要件の「スコープ外」にしている。回答者はログインしない（S5）ので、人を見分ける手がかりが無い
- 対処は、ホストの操作で行う案を設計する（#363）。案は、ホストが参加者を外す操作と、参加を締め切る操作。外された人が入り直せるか、外した人の点をどう扱うか、締め切ったあとのつなぎ直しを通すかを ADR で決める
- 見えない名前と、重ねた結合文字は断る（#353）。見た目の似た別の文字は、正規化で1つにまとめると別の人を断ってしまうので、断らない

見直す合図: #363 の ADR ができたとき（この節をその ADR へのリンクに直す）。

### ホストの入力の制御文字

ホストが書く題名・問題文・選択肢には、制御文字や見えない文字を入れられる。投影の画面の表示を崩すことはできる。

- ホストは許可リストで選んだ人で、信頼する。崩しても困るのは、その人自身の部屋
- 文字のまま描くので、制御文字が要素やスクリプトになることはない（「画面」の表）

見直す合図: 知らない人をホストにすることになったとき。

### Trusted Types を使わないこと

CSP の `require-trusted-types-for 'script'` は付けない。

- 違反の報告を受け取る口（`report-to` の送り先）が無い。報告を受けずに本番で強制すると、ライブラリの更新で違反が起きたときに、画面が黙って壊れても気付けない。受け口を作ると、Worker の枠を使い、ログに残すものも増える
- 守りたいもの（HTML として解釈される API に利用者の入力を渡さないこと）は、React が文字として描くことと、oxlint が `innerHTML` のような API を断ることで守っている（「画面」の表）

見直す合図: CSP の違反の報告を受け取る仕組みを作るとき。

### mise のチェックサムの lock を使わないこと

`mise.lock`（ツールの版・取得先・チェックサムを記録するファイル）は置かない。node・pnpm などのツールは `.mise.toml` で版まで固定しているが、同じ版の配布物が差し替えられたときは気付けない。

- `.mise.toml` は Dependabot が上げないので、手で上げている（[operations.md の「Dependabot での更新」](../architecture/operations.md#dependabot-での更新)）。lock を置くと、上げるたびに手元の macOS と CI の Linux の両方の分を作り直す手間が増える
- トークンを扱う `deploy` は、ほかの job が書き込めるキャッシュを読まない（「CI とデプロイ」の表）。lock が守るのは配布元が汚された場合で、そこまでは受け入れる

見直す合図: mise が Dependabot か別の自動の更新で上がるようになったとき、またはツールの配布物が差し替えられた事件が起きたとき。

### ログに部屋 ID が7日残ること

部屋の URL（`/r/<部屋 ID>`）と WebSocket の経路（`/api/rooms/<部屋 ID>/ws/play`）は、Workers Logs と `wrangler tail` に残る。ログは7日で消える（O1、[logs.md](../runbooks/logs.md#ログに残るもの残らないもの)）。部屋 ID は参加の鍵（S3）なので、ログを見た人は、その部屋が終わるまで参加できる。

- ログを見られるのは開発者だけ。手元に残したファイルは、人に渡したり、どこかに貼ったりしない（logs.md）
- 部屋は今は終わるまで開いている。#360 で部屋に寿命を設けると、古い部屋 ID は使えなくなる
- 部屋 ID は、アプリが足すログの決まったキー（logs.md の `roomId`）にも出してよいものとして扱う。秘密・名前・メッセージの本文とは違い、ログを見られる人が部屋に入れるだけで、回答者になりすますことはできない。手元のファイルや画面に残る負荷試験のボットのログは、部屋を `部屋1` のような名前で書く（S3）

見直す合図: ログを開発者以外も見るようになったとき。

## この文書の直し方

- 守りを足したら、「確かめた守り」の表に「守り｜どこで｜確かめるテスト」の3列で1行足す。テストの無い守りは、この表に書かない。テストを書くか、「受け入れたリスク」に理由を書く
- #341 の子 Issue が入ったら、「これから入れる守り」の行を「確かめた守り」へ移す
- リスクを受け入れると決めたら、理由と見直す合図を書く。要件を変える決定なら、[要件定義書](../requirements/zubatto-quiz.md)も同じ変更で直す
