# 本番のデプロイ

本番のデプロイとマイグレーションは、GitHub Actions の workflow（[.github/workflows/deploy.yaml](../../.github/workflows/deploy.yaml)）で行う。workflow は手で動かしたとき（`workflow_dispatch`）にだけ動き、そのときに版の上げ方（`bump`）を選ぶ（ADR 0012）。PR を main にマージしただけでは動かない。本番の最中は何もデプロイしない決まり（ADR 0006・0012）を、マージで破らないため（ADR 0005）。

本番に出す job は、動くたびに承認を待つ（Environment `production` の Required reviewers。ADR 0009）。ボタンを押し間違えても、承認しなければ本番には何も出ず、タグも Release も作らない。

main の上で動かしてデプロイが成功すると、そのコミットにタグ `vX.Y.Z` と GitHub Release を作り、CHANGELOG の PR を開く（[release.md](release.md)）。

手元からは `wrangler deploy` しない。デプロイの手順が workflow のファイルに残り、手元の `wrangler.jsonc` に D1 の ID が書き戻されることもない。

## 何が動くか

いつも全体（マイグレーション → API の Worker → 画面の Worker）を出す。画面だけを出す道はない（ADR 0012 の K1）。

| どこで動かすか                          | 動くもの                                                                                                                                               | 承認 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| main（ふだん）                          | `verify-ci`（版を決める → CI を待つ）→ `deploy`（確かめ直す → マイグレーション → API の Worker → 画面）→ `release`（CHANGELOG の PR → タグと Release） | 1回  |
| タグ `vX.Y.Z`（出し直す・前の版に戻す） | `verify-ci`（CI を待つ）→ `deploy`（マイグレーション → API の Worker → 画面）                                                                          | 1回  |

- main の上なら、はじめに `verify-ci` が次の版を決める（[.github/scripts/release.sh](../../.github/scripts/release.sh) の `plan`）。基準は最新の `v*` タグで、そこから動かしたコミットまでの commit を読む。次のどれかなら、ここで止まり、承認の画面まで来ない
  - `bump` が `auto` で、feat・fix・perf・破壊的変更（`!`）がない
  - 最新の `v*` タグが、動かしたコミットの祖先でない（これまでの版を含まないコミットを出さない）
  - 最新の `v*` タグが、すでに動かしたコミットを指している（同じコミットに2つ目の版は作らない。出し直すときはタグの上で動かす）
  - 前の CHANGELOG の PR（ブランチが `changelog/` で始まる、開いた PR）がある
- 決めた版・その理由・リリースノートの文面は、run のまとめ（Summary）に出る。承認の前に読める
- 続けて `verify-ci` が、動かしたコミットが main の履歴にあるかと、そのコミットで必須のチェック（`ci`・`e2e`・`pr-title`）が成功しているかを確かめる。main にないコミットなら止まる。失敗したチェックがあれば止まる。まだ走っているチェックと、まだ見つからないチェックは、終わるまで待つ（30 秒ごとに確かめ、30 分で止める）。GitHub の API から読めなかったとき（`api_error`）も、次の周で確かめ直す。止まったときは、本番には何も出さない
  - main にマージした直後に動かすと、main の CI が走っている間に始まる。待たずに止めると、毎回動かし直すことになる（ADR 0010 の Q1）
  - 版を先に決めるので、上げるものがないときは、CI を 30 分待たずに止まる
  - main の履歴にあるかは、GitHub の compare API（`main...<コミット>`）で見る。`identical`（main の先頭）か `behind`（main の先頭より前。動かしたあとに別の PR が入ったときや、前の版のタグで動かしたとき）なら、main にある
  - 確かめるチェックの名前は、main のルールセット（[main-ruleset.json](main-ruleset.json)）の必須のチェックから読む。ルールセットにチェックを足せば、`verify-ci` も同じものを見る
  - PR の CI は、試しのマージコミットで動くので、main に入ったコミットにはチェックが付かない。そのため `ci.yaml` は main への push でも動く
  - `verify-ci` は本番に触らないので、Environment（`production`）を使わず、Cloudflare のトークンも読まない。読めるのはコード・check run・PR だけ。CI を待っている間に、トークンを読める job はない
  - 確かめ方は [.github/scripts/verify-required-checks.sh](../../.github/scripts/verify-required-checks.sh) にある。`pnpm run lint` が shellcheck にかけ、`tools/docs-check` のテストが偽の `gh` で動かす
- main の上なら、`deploy` は最初に、最新の `v*` タグがまだ `verify-ci` の基準のタグと同じかと、前の CHANGELOG の PR が開いていないかを確かめ直す（`release.sh guard`）。**Re-run failed jobs** は成功済みの `verify-ci` を動かし直さないので、古い run を動かし直したときに、あとから出た版を古いコミットで上書きしないようにする。依存パッケージを入れる step と、Cloudflare の secret を読む step より前にある
- main の上なら、`deploy` が成功したあとに `release` が動く。先に CHANGELOG の PR を作り、次にデプロイしたコミットへ Release とタグを作る。どの手順も、すでにあれば飛ばす（[release.md の「何が動くか」](release.md#何が動くか)）。`deploy` が失敗したときと、タグの上で動かしたときは動かない

- 承認は、`production` を使う job ごとに求められる（2026-10-27 に、job を3つに分けていたころの `all` で確かめた。ドキュメントには書かれていない）。`production` を使う job は `deploy` の1つだけにしてあるので、承認は1回になる（ADR 0010）。`release` は `release` の Environment を使い、承認は求めない
  - 承認を1回にするのに、承認だけの job を先頭に置き、`production` から reviewers を外す形は採らない。Cloudflare のトークンを持つ `production` に承認を付けておけば、main のどの workflow がそれを使っても、承認なしではトークンを読めない（ADR 0009）
- 注: Cloudflare のドキュメントでは、コードの更新を含むデプロイで部屋の DO は再起動し、WebSocket はすべて切れる。ただ、O2 のリハーサルでは、眠っていた部屋の接続は切れずに新しい版へ引き継がれた（[記録](../rehearsal/o2-rehearsal.md#わかったこと)）。いつ切れるかを当てにできないので、本番の最中はデプロイしない
- 画面の Worker をデプロイしても、開いている画面は、リロードするまで前のコードのまま動く。メッセージの仕様が変わっていなければ、そのまま遊び続けられる（[O2 のリハーサル](../rehearsal/o2-rehearsal.md#わかったこと)で確かめた）
- メッセージの仕様は、API と画面のどちらが先に新しくなっても動くように変える。API を先に出すので、開いたままの前の画面は、新しい API のメッセージを読む。画面は知らない項目を取り除いて読むので、サーバーが項目を足しても前の画面は動く。逆に、新しい画面がその項目を必須にすると、前の API（Go 版に向けたときなど）から届いたメッセージを捨ててしまう。サーバーのメッセージに項目を足すときは、受け取る側でないときの値を決める（`myResult.bonusPoints` は `.default(0)`）。`ws.schema.json` は送る形で書くので、そこでは必須のまま残る
- `deploy` の job は、D1 のマイグレーション（`wrangler d1 migrations apply DB --remote`）→ API の Worker → 画面の Worker の順に step を行う。画面の Worker が Service binding で API の Worker を呼ぶので、API を先にする（ADR 0006）
- どれかの step が失敗すると、その後ろの step は動かない。`verify-ci` が止まると、`deploy` も `release` も動かない
- 同じ workflow は同時に1つしか動かない。動いている間にもう一度動かすと、新しいほうは前のものが終わるまで待つ。動いているものは途中で止めない。1つずつ動くので、次の run が版を数えるのは、前の run の `release` がタグを打ったあとになる
- 待てるのは1つだけ。待っている run があるときにさらに動かすと、待っていた run は取り消され（Cancelled）、新しいほうに置き換わる。頼んだ run がすべて動くとは限らない（2026-10-17 に GitHub のドキュメントで確かめた）
  - 最後にデプロイされるのは、いつも最後に頼んだ run のコードになる。続けて動かしたときは、Actions の一覧で取り消された run がないかを見る
  - 承認を待っている run も、動いている1つに数えられる。承認を待っている run があるときに動かすと、新しい run は `verify-ci` も始まらないまま `pending` で待ち、前の run が終わってから動き出した（2026-10-31 に v1.1.0 で確かめた）
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

さらに、デプロイしてよい ref を、main ブランチと `v*` のタグだけに絞る。`workflow_dispatch` はどのブランチやタグの上でも動かせるので、絞らないと、マージ前のブランチのコードを本番にデプロイでき、トークンも読めてしまう。`v*` のタグは、出し直すときと前の版に戻すとき（そのタグの上で動かす）のために許す（ADR 0010・0012）。

`v*` を許す前に、`v*` のタグをリリースの App だけが作れるようにしておく（[branch-protection.md の「タグのルールセットを作る」](branch-protection.md#タグのルールセットを作る)）。タグのルールセットがないまま許すと、書き込みの権限があれば誰でも、好きなコミットに `v*` を打って本番に出せる。

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

### 版を出す（ふだん）

出したい変更を main にマージしたら、Actions → **Deploy** → **Run workflow** で、Branch を `main` にし、`bump` を選んで動かす。コマンドなら次のとおり。

```sh
gh workflow run deploy.yaml --ref main -f bump=auto
gh run watch
```

- `bump` は、ふだんは `auto` にする。前のタグからの commit に破壊的変更（`!`）があれば major、feat があれば minor、fix か perf があれば patch に上げる（[release.md の「番号の上がり方」](release.md#番号の上がり方)）
- refactor や docs だけで版を出したいとき、auto より大きく上げたいときは、`major`・`minor`・`patch` を選ぶ。選んだ分だけ、前のタグから上げる
- main にマージした直後に動かしてもよい。`verify-ci` が main の CI が終わるのを待つ

1. `verify-ci` が次の版を決め、main の CI が終わるのを待つ。マージの直後は CI が走っているので、数分かかる
2. CI が通ると、`deploy` の前で run が止まり、「Waiting」になる
3. run の画面の Summary で、`verify-ci` が書いた次の版とリリースノートを読む
   - Summary は画面でしか読めない。`gh run view` にも job のログにも出ない。手元で同じものを見るなら、`git fetch --tags` してから `node tools/release/src/cli.ts --bump <その run で選んだ bump> --to <動かしたコミット>` を動かす（`verify-ci` も同じものを動かしている）。CLI は手元の最新の `v*` タグを基準にするので、出てきた `baseTag` が Summary の「基準のタグ」と同じときだけ、同じ版と文面になる
4. **Review deployments** を押し、`production` を選んで、動いたコミットを見てから **Approve and deploy** を押す。版や文面が違うと思ったら **Reject** する。何も出ず、何も作られない
5. `deploy` が終わると `release` が動く。数分たったら、Summary で決めた版 `vX.Y.Z` のタグ・Release・CHANGELOG の PR ができたことを確かめる。どれも版を書いて確かめる。書かないと、今回のものが作られていなくても、前の版のものが出てくる

   ```sh
   git fetch --tags
   git rev-list -n 1 vX.Y.Z   # 動かしたコミットの SHA が出る
   gh release view vX.Y.Z --json tagName,targetCommitish,url --jq '"\(.tagName) \(.targetCommitish) \(.url)"'
   gh pr list --head changelog/vX.Y.Z --json number,title,url --jq '.[] | "\(.number) \(.title) \(.url)"'
   ```

   - Release を作った時刻は `publishedAt` で読む。`createdAt` は、Release を作った時刻ではなく、タグのコミットの時刻になる（v1.4.0 では、PR が 09:12:56、Release の `publishedAt` が 09:12:58 で、`createdAt` はコミットの 09:05:50 だった）

6. Release ができたことを確かめてから、CHANGELOG の PR を squash でマージする（[release.md の「CHANGELOG の PR をマージする」](release.md#changelog-の-pr-をマージする)）

**本番の最中は動かさない**。動かしてしまったら、承認を押さずに **Reject** する。

### 出し直す・前の版に戻す

タグの上で動かすと、版を決めず、`release` も動かない。そのタグのコミットを、そのまま本番に出す。

```sh
gh workflow run deploy.yaml --ref v1.4.0   # 最新のタグで出し直す・前の版に戻す
gh run watch
```

- 使われる deploy.yaml も、そのタグのコミットのものになる（`bump` の欄は使われない）
- 新しいタグ・Release・CHANGELOG の PR はできない。`verify-ci` の版を決める step と、`deploy` の `Recheck release base` は skipped になり、`release` も skipped になる（2026-11-14 に v1.4.0 で出し直して確かめた）
- **v1.3.0 までのタグに戻すときは、`target` に `all` を選ぶ**。そのころの deploy.yaml には `target` の欄があり、既定は `web`。既定のまま動かすと画面だけが戻り、API の Worker は新しいまま残る（v1.0.0〜v1.3.0 のどのタグの deploy.yaml も、`web` と `all` の2つで、既定は `web`。2026-11-14 に確かめた）

  ```sh
  gh workflow run deploy.yaml --ref v1.3.0 -f target=all
  ```

- v1.0.0 の deploy.yaml は job が3つに分かれていた形なので、`all` では承認が3回になり、`verify-ci` は CI を待たない
- 前の版に戻したあとは、本番が最新のタグより古くなる。本番に何があるかは、[下の「デプロイのあとに確かめる」](#デプロイのあとに確かめる)の 0 で読む。次に main で動かすと、main の先頭が次の版として出る
- 何も変えずに出し直すときも、main ではなく最新のタグの上で動かす。main で動かすと、新しい commit がなければ auto で止まり、patch などを選ぶと、中身が同じ版ができる

### 承認するとき・しないとき

- 承認は1回。承認すると、`deploy` の job が、マイグレーション → API → 画面を続けて行う
- 承認しないまま30日たつと、`deploy` は失敗する。出すのをやめるなら **Reject** を押す。job が1つなので、Reject すると何も出ない。マイグレーションも API も画面も前のままで、タグも Release も PR も作られない
- Reject した run は、失敗として履歴に残る（`deploy` は failure、`release` は skipped）
- Reject しても、production の Deployment は1つ残る。Deployment は承認を待ち始めたときにでき（状態は `waiting`）、Reject すると `failure` になる。job は何も動いていないが、Deployments の一覧の先頭は、この失敗した Deployment になる。前に成功した Deployment は `ACTIVE` のまま残る（2026-11-14 に v1.4.0 のタグの run で確かめた）
- Reject した run も、**Re-run all jobs** で動かし直して承認すれば出せる。そのときは新しい Deployment ができ、Reject したときの Deployment は `failure` のまま残る（同じ日に確かめた）

終わったら、[下の「デプロイのあとに確かめる」](#デプロイのあとに確かめる)を行う。

## デプロイのあとに確かめる

デプロイのたびに、すべて行う。

0. 本番の API と画面の Worker が、それぞれどのコミットか。`deploy` の job の「Deploy API Worker」「Deploy web Worker」の step が成功した、いちばん新しい run の SHA を読む。v1.3.0 までの run には、画面だけを出した run（「Deploy API Worker」の step が skipped）があるので、step ごとに読む。どの版かは、そのコミットから一番近いタグで分かる。main で出して `release` まで終わったときは `vX.Y.Z` ちょうどになる。タグのあとに `-<数>-g<SHA>` が付くときは、`release` がまだタグを作っていないか、v1.3.0 までに版になっていない変更を出した（[release.md](release.md)）

   ```sh
   git fetch --tags
   for step in 'Deploy API Worker' 'Deploy web Worker'; do
     for id in $(gh run list --workflow deploy.yaml --limit 20 --json databaseId --jq '.[].databaseId'); do
       sha=$(gh run view "$id" --json headSha,jobs --jq "select(any(.jobs[].steps[]; .name == \"$step\" and .conclusion == \"success\")) | .headSha")
       if [ -n "$sha" ]; then echo "$step: $sha"; git describe --tags --match 'v*' "$sha" || echo '（まだタグがない）'; break; fi
     done
   done
   ```

   - タグの上で動かした run（v1.3.0 までの Release で動いた run を含む）は、Branch がタグ（`vX.Y.Z`）になる。`--branch main` で絞ると見落とすので、絞らない
   - job を3つに分けていたころ（v1.0.0 まで）の run も、step の名前が同じなので、同じコマンドで読める
   - Environments の `production`（リポジトリのトップの Deployments）の一覧は、いつ何を出そうとしたかを見るのに使う。ただし Deployment は `deploy` の job ごとに作られ、その job が失敗しても、承認を Reject しても残る（[上の「承認するとき・しないとき」](#承認するときしないとき)）。`release` の job も、動くたびに Environment `release` に Deployment を1つ作る（Re-run でも増える）。`all` で API の step が失敗すると、いちばん新しい Deployment は、出ていないコミットになる。なので本番の版は、上のように step の結果から読む
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

| どこで止まったか                   | よくある理由                                                                                | どうするか                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| どれも動かない                     | 「Branch "..." is not allowed to deploy to production due to environment protection rules」 | main 以外のブランチで動かした。main にマージしてから、Branch を `main` にして動かす                                                                                                                                                                                                                                                                                 |
| どれも動かない                     | タグの上で動かして、同じく「... is not allowed to deploy to production ...」で止まる        | `v*` でないタグで動かしたか、production に `v*` を足していない（上の「GitHub の Environment（production）を作る」）                                                                                                                                                                                                                                                 |
| `verify-ci` の Plan release        | 「vX.Y.Z のあとに feat・fix・perf・破壊的変更がない」                                       | auto で上げるものがない。出すなら `patch` などを選んで動かし直す。何も変えずに出し直すなら、最新のタグの上で動かす                                                                                                                                                                                                                                                  |
| `verify-ci` の Plan release        | 「vX.Y.Z はすでにこのコミットを指している」                                                 | そのコミットはもう版になっている。出し直すなら、そのタグの上で動かす（上の「出し直す・前の版に戻す」）                                                                                                                                                                                                                                                              |
| `verify-ci` の Plan release        | 「vX.Y.Z がこのコミットの祖先でない」                                                       | 最新のタグを含まないコミットで動かした。main で動かす                                                                                                                                                                                                                                                                                                               |
| `verify-ci` の Plan release        | 「前の CHANGELOG の PR（changelog/vX.Y.Z）が開いている」                                    | その版の Release ができていれば、PR をマージしてから動かし直す。Release がなければ、その版の run の `release` が途中で失敗している。下の「release が途中で失敗したとき」                                                                                                                                                                                            |
| `deploy` の Recheck release base   | 「最新の v* タグ（…）が、verify-ci が版を決めたときの基準のタグ（…）と違う」                | 古い run を **Re-run** した。あとから別の版が出ているので、その run は出さない。出したいコミットがあれば、main で新しく動かす                                                                                                                                                                                                                                       |
| 承認のところ                       | 「Waiting」のまま進まない                                                                   | 承認を待っている。run の画面の **Review deployments** から承認する（上の「動かす」）                                                                                                                                                                                                                                                                                |
| 承認のところ                       | Reject した・承認しないまま30日たった                                                       | 何も出ていない。出すなら、その run の **Re-run all jobs** で動かし直して承認する                                                                                                                                                                                                                                                                                    |
| `verify-ci`                        | 「… は main の履歴にない（ahead）」（`diverged` も同じ）                                    | main にマージしていないコミットで動かした。main にマージしてから、main で動かす                                                                                                                                                                                                                                                                                     |
| `verify-ci`                        | 「… の ci が 1800 秒待っても終わらない（in_progress）」（`queued` も同じ）                  | main の CI が30分で終わらなかった。Actions の CI の run を見て、通ってから、その run の **Re-run failed jobs** で動かし直す                                                                                                                                                                                                                                         |
| `verify-ci`                        | 「… の ci が 1800 秒待っても終わらない（not_found）」                                       | main への push で CI が動いていない。Actions → **CI** → **Run workflow** を main で動かし、通ってから動かし直す                                                                                                                                                                                                                                                     |
| `verify-ci`                        | 「… の ci が 1800 秒待っても終わらない（api_error）」                                       | GitHub の API から check run を読めないまま30分たった。ログの `gh` のエラー（すぐ上の行）を見る。GitHub の障害なら、直ってから **Re-run failed jobs** で動かし直す                                                                                                                                                                                                  |
| `verify-ci`                        | 「… の e2e が成功していない（failure）」                                                    | そのコミットはテストが落ちている。直して main にマージし、次のリリースで出す。落ちたのが不安定なテストなら、CI の run の **Re-run failed jobs** で通してから、deploy の run を動かし直す                                                                                                                                                                            |
| `verify-ci`                        | 「… の ci が成功していない（cancelled）」                                                   | CI が途中で止まった。Actions の CI の run で **Re-run all jobs** を行い、通ってから動かし直す                                                                                                                                                                                                                                                                       |
| `deploy` の Install tools via mise | 取得の失敗や通信のエラー                                                                    | GitHub やツールの配布元の不調。この試行では、後ろの step は動いていない。Re-run の試行なら、前の試行で終えた step の変更は本番に残っているので、どこまで終えたかを前の試行のログで確かめる。`deploy` はキャッシュを読まないので毎回取り直す（[理由](../architecture/operations.md#mise-の版とキャッシュ)）。下の注を読んでから、**Re-run failed jobs** で動かし直す |
| `deploy` の Apply D1 migrations    | D1 が見つからず、`wrangler d1 create` を実行するように言われる                              | 本番の D1 をまだ作っていない。[README](../../README.md#本番の環境を一から作る)の手順 2 で作ってから、もう一度動かす                                                                                                                                                                                                                                                 |
| `deploy` の Apply D1 migrations    | 認証のエラー（Authentication error など）                                                   | トークンに D1 の Edit がないか、別のアカウントに絞っている。トークンを作り直す（下）                                                                                                                                                                                                                                                                                |
| `deploy` の Deploy API Worker      | 「Missing required secrets」や「This Worker does not exist yet」                            | アプリのシークレットが入っていない。[secrets.md](secrets.md#本番-wrangler-secret-put)で入れてから、もう一度動かす                                                                                                                                                                                                                                                   |
| `deploy` の Deploy web Worker      | ビルドかデプロイのエラー                                                                    | 直して main にマージし、もう一度動かす。同じコードのままなら、失敗した run の **Re-run failed jobs** でもよい（マイグレーションと API も、もう一度行われる）                                                                                                                                                                                                        |
| `release`                          | どこかの step で落ちた                                                                      | 本番には出ている。下の「release が途中で失敗したとき」                                                                                                                                                                                                                                                                                                              |

- マイグレーションが通って API の step が止まると、新しいスキーマを古い API のコードが使っている状態になる。マイグレーションは古いコードでも動くもの（テーブルや列を足すもの）にしているので、そのまま動き続ける（ADR 0005）。直してもう一度 `all` で動かすと、当て済みのマイグレーションは飛ばされる（「No migrations to apply!」）
- **Re-run failed jobs** は、失敗した job をはじめから動かす。`deploy` は1つの job なので、画面の step だけが失敗したときも、マイグレーション（当て済みなら飛ばされる）と API の Worker が、もう一度行われる。本番の外なら困らない
- **Re-run は、いちばん新しい run にだけ使う**。古い run の Re-run は、ふつうは `deploy` の最初の確かめ直しで止まるが、止められない場面がある（下の「release が途中で失敗したとき」）

### release が途中で失敗したとき

`release` が落ちても、本番には出ている。`release` だけを **Re-run failed jobs** で動かし直せば、デプロイはやり直さずに、続きから終わる。どの手順も、すでにあれば飛ばす。

1. 落ちた run を開き、`release` のどの step で落ちたかを見る。App の token や Environment の設定が原因なら、先に直す（[release.md の「失敗したとき」](release.md#失敗したとき)）
2. その run の **Re-run failed jobs** を押す。`verify-ci` と `deploy` は成功しているので動かず、`release` だけが動く。承認も求められない
3. タグ・Release・CHANGELOG の PR ができたことを確かめる（上の「版を出す」の 5）

- CHANGELOG の PR を作ったあとで落ちたとき: 開いたままの PR が残る。終わらせるまで、次の dispatch は `verify-ci` で止まる（「前の CHANGELOG の PR が開いている」）。Release ができる前にその PR をマージしない。マージすると、この止める仕組みが効かなくなる
- CHANGELOG の PR を作る前に落ちたとき（App の token を作る、ブランチを作る、ファイルを書き換えるなど）: PR も Release も残らず、次の dispatch も止まらない。run の失敗を見て、自分で Re-run する。そのままにすると、デプロイしたコミットにタグがないまま残る
  - 書き換えたあとで落ちると、ブランチ `changelog/vX.Y.Z` だけが残ることがある。Re-run すれば、そのブランチを使って続きから終わる
  - Re-run せずに次の版を出したときは、次の run が同じ番号を選ぶことがある。そのときは、次の run の `release` が残ったブランチを使い、同じ版の節を、次の run の文面（前のタグから次の run のコミットまで）で作り直す。落ちた run の変更も、この文面に入るので失われない。落ちた run の番号は、次の run が使う
- Re-run では直らない落ち方もある。Re-run は最初の run の deploy.yaml（App の token に頼む権限を含む）のまま動くので、deploy.yaml の権限が足りずに落ちたときは、あとから deploy.yaml を直しても通らない。[release.md の「Release を手で作る」](release.md#release-を手で作る)の手順で、その版の Release を手で作る
- Re-run は、いちばん新しい run にだけ使う。新しい run の `release` が PR を作る前に落ちた状態では、タグも PR もなく、最新のタグは前と同じままなので、それより古い run を Re-run すると、`deploy` の確かめ直しを素通りして、古いコミットで本番を上書きしてしまう
- `release` の最初の確かめ（`check-release`）は、タグ `vX.Y.Z` がすでにデプロイしたコミットにあれば何もせずに終わる。成功した run の `release` だけを Re-run しても（run の画面で `release` の job を選ぶか、`gh run rerun <run の ID> --job <job の ID>`）、「vX.Y.Z はすでにこのコミットにある」と出て、PR・Release・タグは増えない（2026-11-14 に v1.4.0 で確かめた）。タグが別のコミットにあるとき、または最新の `v*` タグが基準のタグと違うときは、何も作らずに止まる。止まったときは、あとから別の版が出ている。その run の変更は、次の版の CHANGELOG に入る

## トークンを作り直す・やめる

- 作り直すとき（漏れたかもしれないときを含む）: 新しいトークンを作り、`gh secret set CLOUDFLARE_API_TOKEN --env production` で上書きしてから、ダッシュボードの Account API tokens で古いトークンを消す
- デプロイをやめるとき: ダッシュボードでトークンを消し、`gh secret delete CLOUDFLARE_API_TOKEN --env production` と `gh secret delete CLOUDFLARE_ACCOUNT_ID --env production` で GitHub からも消す（ADR 0005）。Worker を止める手順は [stop-and-usage.md](stop-and-usage.md#止める)
