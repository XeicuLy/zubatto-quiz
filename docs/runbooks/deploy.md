# 本番のデプロイ

本番のデプロイとマイグレーションは、GitHub Actions の workflow（[.github/workflows/deploy.yaml](../../.github/workflows/deploy.yaml)）を手で動かして行う。main にマージしてもデプロイしない。本番の最中は API の Worker をデプロイしない決まり（ADR 0006）を、マージで破らないため（ADR 0005）。

本番に出す job は、動かすたびに承認を待つ（Environment `production` の Required reviewers。ADR 0009）。ボタンを押し間違えても、承認しなければ本番には何も出ない。

手元からは `wrangler deploy` しない。デプロイの手順が workflow のファイルに残り、手元の `wrangler.jsonc` に D1 の ID が書き戻されることもない。

## 何が動くか

動かすときに `target` を選ぶ。

| target        | 動く job                                              | 本番の最中に選んでよいか                                | 承認 |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------- | ---- |
| `web`（既定） | `verify-ci` → `deploy-web`                            | よい。画面の Worker だけなら、部屋の接続は切れない      | 1回  |
| `all`         | `verify-ci` → `migrate` → `deploy-api` → `deploy-web` | 選ばない。部屋の WebSocket が切れることがある（下の注） | 3回  |

- どちらでも、はじめに `verify-ci` が、動かしたコミットで必須のチェック（`ci`・`e2e`・`pr-title`）が成功しているかを確かめる。どれかが失敗しているか、まだ走っているか、見つからなければ止まり、本番には何も出さない
  - 確かめるチェックの名前は、main のルールセット（[main-ruleset.json](main-ruleset.json)）の必須のチェックから読む。ルールセットにチェックを足せば、`verify-ci` も同じものを見る
  - PR の CI は、試しのマージコミットで動くので、main に入ったコミットにはチェックが付かない。そのため `ci.yaml` は main への push でも動く
  - `verify-ci` は本番に触らないので、Environment（`production`）を使わず、Cloudflare のトークンも読まない。読めるのはコードと check run だけ
  - 確かめ方は [.github/scripts/verify-required-checks.sh](../../.github/scripts/verify-required-checks.sh) にある。`pnpm run lint` が shellcheck にかけ、`tools/docs-check` のテストが偽の `gh` で動かす

- 承認は、`production` を使う job ごとに求められる。`all` では `migrate`・`deploy-api`・`deploy-web` の前に1回ずつ、合わせて3回になる。前の job の承認は、後ろの job には効かない（2026-10-27 に `all` を動かして確かめた。ドキュメントには書かれていない）
  - 承認を1回にまとめる形（承認だけの job を先頭に置き、`production` から reviewers を外す）は採らない。Cloudflare のトークンを持つ `production` に承認を付けておけば、main のどの workflow がそれを使っても、承認なしではトークンを読めない。`all` は本番の外でたまに出すだけなので、3回押す手間はまれ
- 注: Cloudflare のドキュメントでは、コードの更新を含むデプロイで部屋の DO は再起動し、WebSocket はすべて切れる。ただ、O2 のリハーサルでは、眠っていた部屋の接続は切れずに新しい版へ引き継がれた（[記録](../rehearsal/o2-rehearsal.md#わかったこと)）。いつ切れるかを当てにできないので、本番の最中は `all` を選ばない
- `web` をデプロイしても、開いている画面は、リロードするまで前のコードのまま動く。メッセージの仕様が変わっていなければ、そのまま遊び続けられる（[O2 のリハーサル](../rehearsal/o2-rehearsal.md#わかったこと)で確かめた）
- メッセージの仕様は、API と画面のどちらが先に新しくなっても動くように変える。画面は知らない項目を取り除いて読むので、サーバーが項目を足しても前の画面は動く。逆に、新しい画面がその項目を必須にすると、`web` だけをデプロイしたときに、前の API から届いたメッセージを捨ててしまう。サーバーのメッセージに項目を足すときは、受け取る側でないときの値を決める（`myResult.bonusPoints` は `.default(0)`）。`ws.schema.json` は送る形で書くので、そこでは必須のまま残る
- `all` は、D1 のマイグレーション（`wrangler d1 migrations apply DB --remote`）→ API の Worker → 画面の Worker の順に行う。画面の Worker が Service binding で API の Worker を呼ぶので、API を先にする（ADR 0006）
- どれかが失敗すると、その後ろの job は動かない。`verify-ci` が失敗すると、`web` でも `all` でも何も動かない
- 同じ workflow は同時に1つしか動かない。動いている間にもう一度動かすと、新しいほうは前のものが終わるまで待つ。動いているものは途中で止めない
- 待てるのは1つだけ。待っている run があるときにさらに動かすと、待っていた run は取り消され（Cancelled）、新しいほうに置き換わる。頼んだ run がすべて動くとは限らない（2026-10-17 に GitHub のドキュメントで確かめた）
  - 最後にデプロイされるのは、いつも最後に頼んだ run のコードになる。困るのは、取り消された run の target が `all` で、残ったほうが `web` のとき。マイグレーションと API のデプロイが行われないまま終わる
  - 続けて動かしたときは、Actions の一覧で取り消された run がないかを見る。あれば、そのときの target で動かし直す
  - すべての run を並べて順に動かす設定（`queue: max`）は使わない。並んだ順に動く保証がなく、古いコミットの run があとから動いて、古い画面に戻ることがありうる
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

続けて、本番に出す job が承認を待つようにする（Required reviewers）。reviewers は自分にする。

```sh
jq -n --argjson id "$(gh api user --jq .id)" '{prevent_self_review: false, can_admins_bypass: false, reviewers: [{type: "User", id: $id}], deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' \
  | gh api -X PUT repos/XeicuLy/zubatto-quiz/environments/production --input -
```

- `prevent_self_review` は `false` にする。`true` にすると、自分で動かした run を自分で承認できず、1人ではデプロイできなくなる
- `can_admins_bypass` は `false` にする。`true` だと、管理者（自分）は承認の画面で決まりを飛ばせてしまう
- PUT は送らなかった項目を既定に戻すので、`deployment_branch_policy` も一緒に送る。「main だけ」の一覧（`deployment-branch-policies`）は別の API にあり、`custom_branch_policies: true` を送れば消えない
- Required reviewers は、Free・Pro・Team のプランでは public のリポジトリでしか使えない。private のリポジトリで使うには Enterprise が要る（2026-10-27 に GitHub のドキュメントで確かめた）。このリポジトリは public なので、Free のまま使える
- 画面からも付けられる。Settings → Environments → `production` → Required reviewers に自分を足し、「Prevent self-review」は外し、「Allow administrators to bypass configured protection rules」も外す

入れたら、名前と決まりを確かめる。最後のコマンドは、`rules` が `branch_policy` と `required_reviewers`、`can_admins_bypass` が `false`、`reviewers` が自分のログイン名だけ、`prevent_self_review` が `false` になっていればよい。

```sh
gh secret list --env production   # CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID がある
gh secret list                    # リポジトリの secret には、どちらもない
gh api repos/XeicuLy/zubatto-quiz/environments/production/deployment-branch-policies --jq '.branch_policies[].name'   # main だけ
gh api repos/XeicuLy/zubatto-quiz/environments/production --jq '{rules: [.protection_rules[].type], can_admins_bypass, reviewers: [.protection_rules[] | select(.type == "required_reviewers") | .reviewers[].reviewer.login], prevent_self_review: (.protection_rules[] | select(.type == "required_reviewers") | .prevent_self_review)}'
```

## 動かす

main の CI が終わってから動かす。マージした直後は、main への push で動いた CI がまだ走っていて、`verify-ci` が止まる。

```sh
gh run list --workflow ci.yaml --branch main --limit 1   # いちばん上の run が completed で success になっている
```

Actions → **Deploy** → **Run workflow** で、Branch を `main` にし、`target` を選んで動かす。コマンドなら次のとおり。

```sh
gh workflow run deploy.yaml --ref main -f target=web   # 画面だけ
gh workflow run deploy.yaml --ref main -f target=all   # マイグレーション → API → 画面（本番の最中は選ばない）
gh run watch
```

動かすと、本番に出す job の前で run が止まり、「Waiting」になる。Actions の run の画面に出る **Review deployments** を押し、`production` を選んで、target と動かしたコミットを見てから **Approve and deploy** を押す。

- `all` では3回止まる（`migrate`・`deploy-api`・`deploy-web` の前）。前の job が終わるたびに、次の承認を求められる
- 承認しないまま30日たつと、その job は失敗する。出すのをやめるなら **Reject** を押す。動かないのは、その job とその後ろだけで、前の job がもう終わっていれば、その分は本番に出ている。たとえば `all` で `deploy-web` を拒むと、マイグレーションと API の Worker は新しく、画面の Worker は前のままになる。メッセージの仕様は API と画面のどちらが先に新しくなっても動くように変えている（上の「何が動くか」）ので、そのままでも遊べる。そろえるときは、その run の **Re-run failed jobs** で `deploy-web` だけを動かして承認するか、`web` で動かし直す
- 本番の最中に `web` を出すときは、承認の画面を開いて待っておく。止まってから承認するまで、本番の画面は前のままになる

終わったら、[下の「デプロイのあとに確かめる」](#デプロイのあとに確かめる)を行う。

## デプロイのあとに確かめる

`web` のときは 0〜2 だけでよい。`all` のときと、本番の環境を初めて作ったときは、すべて行う。

0. 本番の API と画面の Worker が、それぞれどのコミットか。`deploy-api`・`deploy-web` が成功した、いちばん新しい run の SHA を読む。どの版かは、そのコミットから一番近いタグで分かる。タグのあとに `-<数>-g<SHA>` が付くときは、本番に版になっていない変更が入っている（[release.md](release.md)）

   ```sh
   git fetch --tags
   for name in deploy-api deploy-web; do
     for id in $(gh run list --workflow deploy.yaml --branch main --limit 20 --json databaseId --jq '.[].databaseId'); do
       sha=$(gh run view "$id" --json headSha,jobs --jq "select(any(.jobs[]; .name == \"$name\" and .conclusion == \"success\")) | .headSha")
       if [ -n "$sha" ]; then echo "$name: $sha"; git describe --tags --match 'v*' "$sha" || echo '（まだタグがない）'; break; fi
     done
   done
   ```

   - Environments の `production`（リポジトリのトップの Deployments）の一覧は、いつ何を出そうとしたかを見るのに使う。ただし Deployment は `production` を使う job ごとに作られ、その job が失敗しても残る。`all` で `deploy-api` が失敗すると、いちばん新しい Deployment は、出ていないコミットになる。なので本番の版は、上のように job の結果から読む
   - 直近の20回の run に、成功した `deploy-api`（`deploy-web`）がなければ、何も出ない。`--limit` を増やす
   - `fatal: No names found` と出るときは、まだ1つもタグがない（最初のリリースの前）。SHA だけを見る

1. 本番の URL（`https://zubakui-web.<サブドメイン>.workers.dev`）が開く
2. 開発者ツールの Console に、`Content Security Policy` の違反が出ていない（ADR 0004）
3. `/login` から GitHub でログインでき、`/admin` に入れる。開発者ツールの Network で、次を見る（ADR 0003・0006）
   - `/api/auth/callback/github` の要求の Request Headers の `Cookie` に、`__Secure-better-auth.state` がある。GitHub から戻る要求は別のサイトからの移動なので、この Cookie が `SameSite=Lax` でないと付かず、ログインできない
   - その応答の `Set-Cookie` の `__Secure-better-auth.session_token` に、`HttpOnly`・`SameSite=Lax`・`Secure` が付いている。名前が `__Secure-` で始まらないときは、`BETTER_AUTH_URL` が `https://` で始まっていない（[secrets.md](secrets.md)）
4. 問題セットを作り、部屋を作る。Network を WS で絞り、`/api/rooms/<部屋の ID>/ws/host` の Request Headers の `Cookie` に `__Secure-better-auth.session_token` がある
5. 別の端末か別のブラウザで参加用の URL を開いて参加し、最終ランキングまで通す。終わったら部屋を終える
6. 1〜5 の間、`pnpm -s run logs:api` を動かしておき（[logs.md](logs.md#本番中に手元のファイルに残す)）、次を見る
   - `/api/rooms/<部屋の ID>/ws/host` の呼び出しの `request.headers` に、`cookie`（値は `REDACTED`）と、本番の URL の `origin` がある。画面の Worker から Service binding で転送しても、2つのヘッダーが API の Worker に届いている（ADR 0006）
   - `"outcome": "exception"` の呼び出しがない
7. ダッシュボードの Observability でも、同じ時間帯にエラーがないことを見る（[logs.md](logs.md#ダッシュボードで見る)）
8. 試しに作った問題セットは、管理画面から消してよい

## 失敗したとき

| どこで止まったか | よくある理由                                                                                | どうするか                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| どれも動かない   | 「Branch "..." is not allowed to deploy to production due to environment protection rules」 | main 以外のブランチで動かした。main にマージしてから、Branch を `main` にして動かす                                 |
| 承認のところ     | 「Waiting」のまま進まない                                                                   | 承認を待っている。run の画面の **Review deployments** から承認する（上の「動かす」）                                |
| 承認のところ     | Reject した・承認しないまま30日たった                                                       | その job とその後ろは動いていないが、前の job の分は出ている（上の「動かす」）。出すなら、もう一度動かして承認する  |
| `verify-ci`      | 「… の ci が成功していない（in_progress）」（`queued` も同じ）                              | main の CI がまだ走っている。終わってから、その run の **Re-run failed jobs** で動かし直す                          |
| `verify-ci`      | 「… の e2e が成功していない（failure）」                                                    | そのコミットはテストが落ちている。直して main にマージし、CI が通ってから動かす                                     |
| `verify-ci`      | 「… の ci が成功していない（cancelled）」                                                   | CI が途中で止まった。Actions の CI の run で **Re-run all jobs** を行い、通ってから動かし直す                       |
| `verify-ci`      | 「… の ci が成功していない（not_found）」                                                   | main への push で CI が動いていない。Actions → **CI** → **Run workflow** を main で動かし、通ってから動かし直す     |
| `migrate`        | D1 が見つからず、`wrangler d1 create` を実行するように言われる                              | 本番の D1 をまだ作っていない。[README](../../README.md#本番の環境を一から作る)の手順 2 で作ってから、もう一度動かす |
| `migrate`        | 認証のエラー（Authentication error など）                                                   | トークンに D1 の Edit がないか、別のアカウントに絞っている。トークンを作り直す（下）                                |
| `deploy-api`     | 「Missing required secrets」や「This Worker does not exist yet」                            | アプリのシークレットが入っていない。[secrets.md](secrets.md#本番-wrangler-secret-put)で入れてから、もう一度動かす   |
| `deploy-web`     | ビルドかデプロイのエラー                                                                    | 直して main にマージし、`web` で動かす。同じコードのままなら、失敗した run の **Re-run failed jobs** でもよい       |

- `migrate` が通って `deploy-api` が止まると、新しいスキーマを古い API のコードが使っている状態になる。マイグレーションは古いコードでも動くもの（テーブルや列を足すもの）にしているので、そのまま動き続ける（ADR 0005）。直してもう一度 `all` で動かすと、当て済みのマイグレーションは飛ばされる（「No migrations to apply!」）
- **Re-run failed jobs** は、失敗した job とその後ろだけを動かす。`deploy-web` だけが失敗したときに使えば、API の Worker を2回デプロイしない

## トークンを作り直す・やめる

- 作り直すとき（漏れたかもしれないときを含む）: 新しいトークンを作り、`gh secret set CLOUDFLARE_API_TOKEN --env production` で上書きしてから、ダッシュボードの Account API tokens で古いトークンを消す
- デプロイをやめるとき: ダッシュボードでトークンを消し、`gh secret delete CLOUDFLARE_API_TOKEN --env production` と `gh secret delete CLOUDFLARE_ACCOUNT_ID --env production` で GitHub からも消す（ADR 0005）。Worker を止める手順は [stop-and-usage.md](stop-and-usage.md#止める)
