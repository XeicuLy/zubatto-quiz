# 本番のデプロイ

本番のデプロイとマイグレーションは、GitHub Actions の workflow（[.github/workflows/deploy.yaml](../../.github/workflows/deploy.yaml)）で行う。workflow は、Release ができたとき（リリース PR をマージしたとき）に動き始めるほか、手でも動かせる（ADR 0010）。ふつうの PR を main にマージしただけでは動かない。本番の最中は API の Worker をデプロイしない決まり（ADR 0006）を、マージで破らないため（ADR 0005）。

本番に出す job は、動くたびに承認を待つ（Environment `production` の Required reviewers。ADR 0009）。Release で動き始めても、ボタンを押し間違えても、承認しなければ本番には何も出ない。

手元からは `wrangler deploy` しない。デプロイの手順が workflow のファイルに残り、手元の `wrangler.jsonc` に D1 の ID が書き戻されることもない。

## 何が動くか

Release で動くときは、いつも `all` になる（前のタグとの差は見ない。ADR 0010）。手で動かすときは `target` を選ぶ。

| きっかけ           | 動くもの                                                          | 本番の最中に動かしてよいか                                                      | 承認 |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---- |
| Release（`all`）   | `verify-ci` → `deploy`（マイグレーション → API の Worker → 画面） | 動かさない。本番の最中はリリース PR をマージしない（[下の「動かす」](#動かす)） | 1回  |
| 手で `web`（既定） | `verify-ci` → `deploy`（画面の Worker だけ）                      | よい。画面の Worker だけなら、部屋の接続は切れない                              | 1回  |
| 手で `all`         | `verify-ci` → `deploy`（マイグレーション → API の Worker → 画面） | 選ばない。部屋の WebSocket が切れることがある（下の注）                         | 1回  |

- どれでも、はじめに `verify-ci` が、動かしたコミットが main の履歴にあるかと、そのコミットで必須のチェック（`ci`・`e2e`・`pr-title`）が成功しているかを確かめる。main にないコミットなら止まる。失敗したチェックがあれば止まる。まだ走っているチェックと、まだ見つからないチェックは、終わるまで待つ（30 秒ごとに確かめ、30 分で止める）。GitHub の API から読めなかったとき（`api_error`）も、次の周で確かめ直す。止まったときは、本番には何も出さない
  - Release の run は、リリース PR のマージで動いた main の CI が走っている間に始まる。待たずに止めると、毎回動かし直すことになる（ADR 0010 の Q1）
  - main の履歴にあるかは、GitHub の compare API（`main...<コミット>`）で見る。`identical`（main の先頭）か `behind`（main の先頭より前。リリースのあとに別の PR が入ったときや、前の版のタグで動かしたとき）なら、main にある
  - 確かめるチェックの名前は、main のルールセット（[main-ruleset.json](main-ruleset.json)）の必須のチェックから読む。ルールセットにチェックを足せば、`verify-ci` も同じものを見る
  - PR の CI は、試しのマージコミットで動くので、main に入ったコミットにはチェックが付かない。そのため `ci.yaml` は main への push でも動く
  - `verify-ci` は本番に触らないので、Environment（`production`）を使わず、Cloudflare のトークンも読まない。読めるのはコードと check run だけ。CI を待っている間に、トークンを読める job はない
  - 確かめ方は [.github/scripts/verify-required-checks.sh](../../.github/scripts/verify-required-checks.sh) にある。`pnpm run lint` が shellcheck にかけ、`tools/docs-check` のテストが偽の `gh` で動かす

- 承認は、`production` を使う job ごとに求められる（2026-10-27 に、job を3つに分けていたころの `all` で確かめた。ドキュメントには書かれていない）。`production` を使う job は `deploy` の1つだけにしてあるので、どのきっかけでも承認は1回になる（ADR 0010）
  - 承認を1回にするのに、承認だけの job を先頭に置き、`production` から reviewers を外す形は採らない。Cloudflare のトークンを持つ `production` に承認を付けておけば、main のどの workflow がそれを使っても、承認なしではトークンを読めない（ADR 0009）
- 注: Cloudflare のドキュメントでは、コードの更新を含むデプロイで部屋の DO は再起動し、WebSocket はすべて切れる。ただ、O2 のリハーサルでは、眠っていた部屋の接続は切れずに新しい版へ引き継がれた（[記録](../rehearsal/o2-rehearsal.md#わかったこと)）。いつ切れるかを当てにできないので、本番の最中は `all` を選ばない
- `web` をデプロイしても、開いている画面は、リロードするまで前のコードのまま動く。メッセージの仕様が変わっていなければ、そのまま遊び続けられる（[O2 のリハーサル](../rehearsal/o2-rehearsal.md#わかったこと)で確かめた）
- メッセージの仕様は、API と画面のどちらが先に新しくなっても動くように変える。画面は知らない項目を取り除いて読むので、サーバーが項目を足しても前の画面は動く。逆に、新しい画面がその項目を必須にすると、`web` だけをデプロイしたときに、前の API から届いたメッセージを捨ててしまう。サーバーのメッセージに項目を足すときは、受け取る側でないときの値を決める（`myResult.bonusPoints` は `.default(0)`）。`ws.schema.json` は送る形で書くので、そこでは必須のまま残る
- `deploy` の job は、D1 のマイグレーション（`wrangler d1 migrations apply DB --remote`）→ API の Worker → 画面の Worker の順に step を行う。画面の Worker が Service binding で API の Worker を呼ぶので、API を先にする（ADR 0006）。`web` では、マイグレーションと API の step を飛ばす
- どれかの step が失敗すると、その後ろの step は動かない。`verify-ci` が止まると、`deploy` は動かない
- 同じ workflow は同時に1つしか動かない。動いている間にもう一度動かすと、新しいほうは前のものが終わるまで待つ。動いているものは途中で止めない
- 待てるのは1つだけ。待っている run があるときにさらに動かすと、待っていた run は取り消され（Cancelled）、新しいほうに置き換わる。頼んだ run がすべて動くとは限らない（2026-10-17 に GitHub のドキュメントで確かめた）
  - 最後にデプロイされるのは、いつも最後に頼んだ run のコードになる。困るのは、取り消された run が `all`（Release の run を含む）で、残ったほうが `web` のとき。マイグレーションと API のデプロイが行われないまま終わる
  - 続けて動かしたときは、Actions の一覧で取り消された run がないかを見る。あれば、そのときの target で動かし直す。Release の run なら、その run の **Re-run all jobs** で動かし直す
  - 承認を待っている run も、動いている1つに数えられる。Release の run が承認を待っている間に `web` を動かすと、`web` の run は `verify-ci` も始まらないまま `pending` で待ち、Release の run が終わってから動き出した（2026-10-31 に v1.1.0 で確かめた）。本番の最中に `web` を出すときに Release の run が承認を待っていたら、先にその run を **Reject** する
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

さらに、デプロイしてよい ref を、main ブランチと `v*` のタグだけに絞る。`workflow_dispatch` はどのブランチやタグの上でも動かせるので、絞らないと、マージ前のブランチのコードを本番にデプロイでき、トークンも読めてしまう。`v*` のタグは、Release のタグのコミットを出すためと、前の版に戻すとき（そのタグの上で動かす）のために許す（ADR 0010）。

`v*` を許す前に、`v*` のタグを release-please の App だけが作れるようにしておく（[branch-protection.md の「タグのルールセットを作る」](branch-protection.md#タグのルールセットを作る)）。タグのルールセットがないまま許すと、書き込みの権限があれば誰でも、好きなコミットに `v*` を打って本番に出せる。

リポジトリのいちばん上で、次を実行する。

```sh
gh api -X PUT repos/XeicuLy/zubatto-quiz/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/XeicuLy/zubatto-quiz/environments/production/deployment-branch-policies \
  -f name=main -f type=branch
gh api -X POST repos/XeicuLy/zubatto-quiz/environments/production/deployment-branch-policies \
  -f name='v*' -f type=tag
gh secret set CLOUDFLARE_API_TOKEN --env production
gh secret set CLOUDFLARE_ACCOUNT_ID --env production
```

- `gh secret set` は値を聞いてくるので、そこで貼る。引数に値を書くと、シェルの履歴に残る
- `v*` は引用符で囲む。囲まないと、シェルがファイル名として展開することがある。名前は fnmatch で読まれ、`*` は `/` をまたがない
- `v*` のタグのルールセットがまだないとき（README の順で一から作るときは、リリースの App があとになる）は、3つ目のコマンドをいったん飛ばす。[release.md の 5](release.md#5-v-のタグを-app-だけが作れるようにする) でルールセットを作ってから実行する
- すでに `production` があるとき（main だけを許していたとき）は、ルールセットを作ってから、`v*` を足す3つ目のコマンドだけを実行すればよい
- 画面からも作れる。Settings → Environments → New environment で `production` を作り、Deployment branches and tags を「Selected branches and tags」にして、`main`（Ref type は Branch）と `v*`（Ref type は Tag）を足し、Environment secrets に2つを入れる

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

入れたら、名前と決まりを確かめる。3つ目のコマンドは、ほかのブランチやタグが混ざっていないことも見る。最後のコマンドは、`rules` が `branch_policy` と `required_reviewers`、`can_admins_bypass` が `false`、`reviewers` が自分のログイン名だけ、`prevent_self_review` が `false` になっていればよい。

```sh
gh secret list --env production   # CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID がある
gh secret list                    # リポジトリの secret には、どちらもない
gh api repos/XeicuLy/zubatto-quiz/environments/production/deployment-branch-policies --jq '.branch_policies[] | "\(.type) \(.name)"'   # branch main と tag v* の2行だけ
gh api repos/XeicuLy/zubatto-quiz/environments/production --jq '{rules: [.protection_rules[].type], can_admins_bypass, reviewers: [.protection_rules[] | select(.type == "required_reviewers") | .reviewers[].reviewer.login], prevent_self_review: (.protection_rules[] | select(.type == "required_reviewers") | .prevent_self_review)}'
```

## 動かす

### Release で動かす（ふだん）

リリース PR をマージすると、release-please がタグ `vX.Y.Z` と Release を作り、その Release で deploy.yaml が `all` で動き始める（[release.md の「ふだんのリリース」](release.md#ふだんのリリース)）。出すのは、Release のタグが指すコミット。本番の版が `vX.Y.Z` ちょうどになる。

```sh
gh run list --workflow deploy.yaml --event release --limit 1   # Branch の欄がタグ（vX.Y.Z）の run
gh run watch
```

1. `verify-ci` が、main の CI が終わるのを待つ。マージの直後は CI が走っているので、数分かかる
2. CI が通ると、`deploy` の前で run が止まり、「Waiting」になる
3. Actions の run の画面に出る **Review deployments** を押し、`production` を選んで、タグと動いたコミットを見てから **Approve and deploy** を押す

**本番の最中は、リリース PR をマージしない**。マージしてしまったら、Release の run の承認を押さずに **Reject** する。本番のあとに出すときは、その run の **Re-run all jobs** で動かし直して（`verify-ci` からやり直す）、承認する。

### 手で動かす

画面だけを出すとき、Release の run を出し直すとき、前の版に戻すときは、手で動かす。Actions → **Deploy** → **Run workflow** で、Branch を `main` にし、`target` を選んで動かす。コマンドなら次のとおり。

```sh
gh workflow run deploy.yaml --ref main -f target=web   # 画面だけ
gh workflow run deploy.yaml --ref main -f target=all   # マイグレーション → API → 画面（本番の最中は選ばない）
gh run watch
```

- main にマージした直後に動かしてもよい。`verify-ci` が main の CI が終わるのを待つ
- 前の版に戻すときは、`--ref` にそのタグ（`--ref v1.0.0` など）を書く。使われる deploy.yaml も、そのタグのコミットのものになる。v1.0.0 の deploy.yaml は job が3つに分かれていた形なので、`all` では承認が3回になり、`verify-ci` は CI を待たない

動かすと、`deploy` の前で run が止まり、「Waiting」になる。Release で動いたときと同じく、**Review deployments** から、target と動かしたコミットを見てから承認する。

### 承認するとき・しないとき

- 承認は、どのきっかけでも1回。承認すると、`deploy` の job が、マイグレーション → API → 画面（`web` では画面だけ）を続けて行う
- 承認しないまま30日たつと、`deploy` は失敗する。出すのをやめるなら **Reject** を押す。job が1つなので、Reject すると何も出ない。マイグレーションも API も画面も、前のままになる
- 本番の最中に `web` を出すときは、承認の画面を開いて待っておく。止まってから承認するまで、本番の画面は前のままになる

終わったら、[下の「デプロイのあとに確かめる」](#デプロイのあとに確かめる)を行う。

## デプロイのあとに確かめる

`web` のときは 0〜2 だけでよい。`all` のときと、本番の環境を初めて作ったときは、すべて行う。

0. 本番の API と画面の Worker が、それぞれどのコミットか。`deploy` の job の「Deploy API Worker」「Deploy web Worker」の step が成功した、いちばん新しい run の SHA を読む。`web` の run では「Deploy API Worker」の step が飛ばされる（skipped）ので、step の結果で `web` と `all` の run を見分けられる。どの版かは、そのコミットから一番近いタグで分かる。Release で出したときは `vX.Y.Z` ちょうどになる。タグのあとに `-<数>-g<SHA>` が付くときは、本番に版になっていない変更が入っている（[release.md](release.md)）

   ```sh
   git fetch --tags
   for step in 'Deploy API Worker' 'Deploy web Worker'; do
     for id in $(gh run list --workflow deploy.yaml --limit 20 --json databaseId --jq '.[].databaseId'); do
       sha=$(gh run view "$id" --json headSha,jobs --jq "select(any(.jobs[].steps[]; .name == \"$step\" and .conclusion == \"success\")) | .headSha")
       if [ -n "$sha" ]; then echo "$step: $sha"; git describe --tags --match 'v*' "$sha" || echo '（まだタグがない）'; break; fi
     done
   done
   ```

   - Release で動いた run は、Branch がタグ（`vX.Y.Z`）になる。`--branch main` で絞ると見落とすので、絞らない
   - job を3つに分けていたころ（v1.0.0 まで）の run も、step の名前が同じなので、同じコマンドで読める
   - Environments の `production`（リポジトリのトップの Deployments）の一覧は、いつ何を出そうとしたかを見るのに使う。ただし Deployment は `deploy` の job ごとに作られ、その job が失敗しても残る。`all` で API の step が失敗すると、いちばん新しい Deployment は、出ていないコミットになる。なので本番の版は、上のように step の結果から読む
   - 直近の20回の run に、成功した「Deploy API Worker」（「Deploy web Worker」）の step がなければ、何も出ない。`--limit` を増やす
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

| どこで止まったか                | よくある理由                                                                                          | どうするか                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| どれも動かない                  | 「Branch "..." is not allowed to deploy to production due to environment protection rules」           | main 以外のブランチで動かした。main にマージしてから、Branch を `main` にして動かす                                                                                                      |
| どれも動かない                  | タグの上で動かすか Release で動いて、同じく「... is not allowed to deploy to production ...」で止まる | `v*` でないタグで動かしたか、production に `v*` を足していない（上の「GitHub の Environment（production）を作る」）                                                                      |
| 承認のところ                    | 「Waiting」のまま進まない                                                                             | 承認を待っている。run の画面の **Review deployments** から承認する（上の「動かす」）                                                                                                     |
| 承認のところ                    | Reject した・承認しないまま30日たった                                                                 | 何も出ていない。出すなら、その run の **Re-run all jobs** で動かし直して承認する                                                                                                         |
| `verify-ci`                     | 「… は main の履歴にない（ahead）」（`diverged` も同じ）                                              | main にマージしていないコミットで動かした。main にマージしてから、main で動かす                                                                                                          |
| `verify-ci`                     | 「… の ci が 1800 秒待っても終わらない（in_progress）」（`queued` も同じ）                            | main の CI が30分で終わらなかった。Actions の CI の run を見て、通ってから、その run の **Re-run failed jobs** で動かし直す                                                              |
| `verify-ci`                     | 「… の ci が 1800 秒待っても終わらない（not_found）」                                                 | main への push で CI が動いていない。Actions → **CI** → **Run workflow** を main で動かし、通ってから動かし直す                                                                          |
| `verify-ci`                     | 「… の ci が 1800 秒待っても終わらない（api_error）」                                                 | GitHub の API から check run を読めないまま30分たった。ログの `gh` のエラー（すぐ上の行）を見る。GitHub の障害なら、直ってから **Re-run failed jobs** で動かし直す                       |
| `verify-ci`                     | 「… の e2e が成功していない（failure）」                                                              | そのコミットはテストが落ちている。直して main にマージし、次のリリースで出す。落ちたのが不安定なテストなら、CI の run の **Re-run failed jobs** で通してから、deploy の run を動かし直す |
| `verify-ci`                     | 「… の ci が成功していない（cancelled）」                                                             | CI が途中で止まった。Actions の CI の run で **Re-run all jobs** を行い、通ってから動かし直す                                                                                            |
| `deploy` の Apply D1 migrations | D1 が見つからず、`wrangler d1 create` を実行するように言われる                                        | 本番の D1 をまだ作っていない。[README](../../README.md#本番の環境を一から作る)の手順 2 で作ってから、もう一度動かす                                                                      |
| `deploy` の Apply D1 migrations | 認証のエラー（Authentication error など）                                                             | トークンに D1 の Edit がないか、別のアカウントに絞っている。トークンを作り直す（下）                                                                                                     |
| `deploy` の Deploy API Worker   | 「Missing required secrets」や「This Worker does not exist yet」                                      | アプリのシークレットが入っていない。[secrets.md](secrets.md#本番-wrangler-secret-put)で入れてから、もう一度動かす                                                                        |
| `deploy` の Deploy web Worker   | ビルドかデプロイのエラー                                                                              | 直して main にマージし、`web` で動かす。同じコードのままなら、失敗した run の **Re-run failed jobs** でもよい（`all` の run では、マイグレーションと API も、もう一度行われる）          |

- マイグレーションが通って API の step が止まると、新しいスキーマを古い API のコードが使っている状態になる。マイグレーションは古いコードでも動くもの（テーブルや列を足すもの）にしているので、そのまま動き続ける（ADR 0005）。直してもう一度 `all` で動かすと、当て済みのマイグレーションは飛ばされる（「No migrations to apply!」）
- **Re-run failed jobs** は、失敗した job をはじめから動かす。`deploy` は1つの job なので、`all` の run で画面の step だけが失敗したときも、マイグレーション（当て済みなら飛ばされる）と API の Worker が、もう一度行われる。本番の外なら困らない。画面だけを出し直すときは、`web` で新しく動かす

## トークンを作り直す・やめる

- 作り直すとき（漏れたかもしれないときを含む）: 新しいトークンを作り、`gh secret set CLOUDFLARE_API_TOKEN --env production` で上書きしてから、ダッシュボードの Account API tokens で古いトークンを消す
- デプロイをやめるとき: ダッシュボードでトークンを消し、`gh secret delete CLOUDFLARE_API_TOKEN --env production` と `gh secret delete CLOUDFLARE_ACCOUNT_ID --env production` で GitHub からも消す（ADR 0005）。Worker を止める手順は [stop-and-usage.md](stop-and-usage.md#止める)
