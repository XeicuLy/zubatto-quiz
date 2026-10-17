# 本番のデプロイ

本番のデプロイとマイグレーションは、GitHub Actions の workflow（[.github/workflows/deploy.yaml](../../.github/workflows/deploy.yaml)）を手で動かして行う。main にマージしてもデプロイしない。本番の最中は API の Worker をデプロイしない決まり（ADR 0006）を、マージで破らないため（ADR 0005）。

手元からは `wrangler deploy` しない。デプロイの手順が workflow のファイルに残り、手元の `wrangler.jsonc` に D1 の ID が書き戻されることもない。

## 何が動くか

動かすときに `target` を選ぶ。

| target        | 動く job                                | 本番の最中に選んでよいか                           |
| ------------- | --------------------------------------- | -------------------------------------------------- |
| `web`（既定） | `deploy-web`                            | よい。画面の Worker だけなら、部屋の接続は切れない |
| `all`         | `migrate` → `deploy-api` → `deploy-web` | 選ばない。部屋の WebSocket がすべて切れる          |

- `all` は、D1 のマイグレーション（`wrangler d1 migrations apply DB --remote`）→ API の Worker → 画面の Worker の順に行う。画面の Worker が Service binding で API の Worker を呼ぶので、API を先にする（ADR 0006）
- どれかが失敗すると、その後ろの job は動かない
- 同じ workflow は同時に1つしか動かない。動いている間にもう一度動かすと、前のものが終わるまで待つ
- 呼ぶスクリプトは root の `db:migrate:remote`・`deploy:api`・`deploy:web`。API の Worker は `--env=""` で本番の設定（`wrangler.jsonc` の先頭）を選ぶ。画面の Worker は `vite build` の直後に `wrangler deploy` する

## はじめに一度だけ用意するもの

[README の「本番の環境を一から作る」](../../README.md#本番の環境を一から作る)の順で行う。D1 とアプリのシークレットは、workflow を動かす前に手元で入れておく。

### Cloudflare の API トークンを作る

workflow が Cloudflare に入るためのトークン。2026-10-17 に Cloudflare のドキュメント（External CI/CD の GitHub Actions のページ）で確かめた。

1. ダッシュボードの **Account API tokens** を開き、**Create Token** を選ぶ
2. テンプレートの **Edit Cloudflare Workers** を選ぶ
3. **Permissions** に、**Account** / **D1** / **Edit** を足す。テンプレートには D1 の権限が入っておらず、ないとマイグレーションが認証のエラーで止まる
4. **Account Resources** と **Zone Resources** を、ズバクイのアカウントだけに絞る
5. 名前を `zubakui-github-actions` などにして作る。値は一度しか表示されないので、すぐ次の手順で GitHub に入れる

アカウント ID は、`apps/api` で `pnpm exec wrangler whoami` を実行すると表示される。ダッシュボードの Workers & Pages の右側にも出ている。

### GitHub の Environment（production）を作る

トークンとアカウント ID は、リポジトリの secret ではなく、Environment（`production`）の secret に入れる。workflow の中で `environment: production` を書いた job だけが読めるので、PR ごとの CI（`ci.yaml`）からは読めない（ADR 0005 の DD4）。

さらに、デプロイしてよいブランチを main だけに絞る。`workflow_dispatch` はどのブランチでも動かせるので、絞らないと、マージ前のブランチのコードを本番にデプロイでき、トークンも読めてしまう。

リポジトリのいちばん上で、次を実行する。

```sh
gh api -X PUT repos/XeicuLy/zubatto-quiz/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/XeicuLy/zubatto-quiz/environments/production/deployment-branch-policies \
  -f name=main -f type=branch
gh secret set CLOUDFLARE_API_TOKEN --env production
gh secret set CLOUDFLARE_ACCOUNT_ID --env production
```

- `gh secret set` は値を聞いてくるので、そこで貼る。引数に値を書くと、シェルの履歴に残る
- 画面からも作れる。Settings → Environments → New environment で `production` を作り、Deployment branches and tags を「Selected branches and tags」にして `main` を足し、Environment secrets に2つを入れる

入れたら、名前だけを確かめる。

```sh
gh secret list --env production   # CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID がある
gh secret list                    # リポジトリの secret には、どちらもない
gh api repos/XeicuLy/zubatto-quiz/environments/production/deployment-branch-policies --jq '.branch_policies[].name'   # main だけ
```

## 動かす

Actions → **Deploy** → **Run workflow** で、Branch を `main` にし、`target` を選んで動かす。コマンドなら次のとおり。

```sh
gh workflow run deploy.yaml --ref main -f target=web   # 画面だけ
gh workflow run deploy.yaml --ref main -f target=all   # マイグレーション → API → 画面（本番の最中は選ばない）
gh run watch
```

終わったら、本番の URL を開いて確かめる。`all` のときは `/login` からログインできることも確かめる。

## 失敗したとき

| どこで止まったか | よくある理由                                                                                | どうするか                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| どれも動かない   | 「Branch "..." is not allowed to deploy to production due to environment protection rules」 | main 以外のブランチで動かした。main にマージしてから、Branch を `main` にして動かす                                 |
| `migrate`        | D1 が見つからず、`wrangler d1 create` を実行するように言われる                              | 本番の D1 をまだ作っていない。[README](../../README.md#本番の環境を一から作る)の手順 2 で作ってから、もう一度動かす |
| `migrate`        | 認証のエラー（Authentication error など）                                                   | トークンに D1 の Edit がないか、別のアカウントに絞っている。トークンを作り直す（下）                                |
| `deploy-api`     | 「Missing required secrets」や「This Worker does not exist yet」                            | アプリのシークレットが入っていない。[secrets.md](secrets.md#本番-wrangler-secret-put)で入れてから、もう一度動かす   |
| `deploy-web`     | ビルドかデプロイのエラー                                                                    | 直して main にマージし、`web` で動かす。同じコードのままなら、失敗した run の **Re-run failed jobs** でもよい       |

- `migrate` が通って `deploy-api` が止まると、新しいスキーマを古い API のコードが使っている状態になる。マイグレーションは古いコードでも動くもの（テーブルや列を足すもの）にしているので、そのまま動き続ける（ADR 0005）。直してもう一度 `all` で動かすと、当て済みのマイグレーションは飛ばされる（「No migrations to apply!」）
- **Re-run failed jobs** は、失敗した job とその後ろだけを動かす。`deploy-web` だけが失敗したときに使えば、API の Worker を2回デプロイしない

## トークンを作り直す・やめる

- 作り直すとき（漏れたかもしれないときを含む）: 新しいトークンを作り、`gh secret set CLOUDFLARE_API_TOKEN --env production` で上書きしてから、ダッシュボードの Account API tokens で古いトークンを消す
- デプロイをやめるとき: ダッシュボードでトークンを消し、`gh secret delete CLOUDFLARE_API_TOKEN --env production` と `gh secret delete CLOUDFLARE_ACCOUNT_ID --env production` で GitHub からも消す（ADR 0005）。Worker を止める手順は [stop-and-usage.md](stop-and-usage.md#止める)
