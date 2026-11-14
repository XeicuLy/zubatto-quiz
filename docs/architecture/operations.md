# 運用の仕組み

インフラの設定、GitHub のルールセット、リリース、本番へのデプロイ、ログと、それらを確かめる `tools/docs-check` のテストが、なぜその形になっているかをまとめる。決めた理由の大もとは [ADR 0005](../adr/0005-infrastructure-management.md)・[ADR 0009](../adr/0009-release-versioning-and-tagging.md)・[ADR 0010](../adr/0010-deploy-on-release.md)・[ADR 0012](../adr/0012-release-after-deploy-with-changelogen.md) にある。手を動かす手順は [README の「運用の手順書」](../../README.md#運用の手順書)から開く runbook にあり、ここには書かない。

コードを書くときに守る約束は、[CLAUDE.md](../../CLAUDE.md) に1行ずつ残している。この文書はその説明で、見出しを変えるときは CLAUDE.md のリンクも直す（docs-check が確かめる）。

## インフラの管理

- インフラの設定は `wrangler.jsonc` だけで書く（ADR 0005）。Worker、DO の `new_sqlite_classes` のマイグレーション、D1 の binding がここにある。本番は Cloudflare に残すので（ADR 0008）、本番には Terraform を入れない。Terraform は Go 版の練習用の環境（本番と別の GCP プロジェクト）だけで使う
- 設定で表せないものは、`docs/runbooks/` の runbook に書く。GitHub の OAuth App（手元用と本番用）、シークレット、ホストの許可リスト、使用量の確かめ方と止め方、main と `v*` のタグのルールセット。シークレット・テーブル・コマンド・CI の job 名など、runbook に関わるものを変えたら、同じ変更で runbook も直す
- シークレットは `wrangler secret put` で入れる。`secrets.required` があると、シークレットのない Worker の最初のデプロイは止まる。そこで本番では、先に `secret put` で空の Worker を作ってからデプロイする。こうすると、デプロイの workflow はアプリのシークレットを持たずに済む。順番と理由は [secrets.md の「はじめて入れるとき」](../runbooks/secrets.md#はじめて入れるとき)にある。Worker を消すとシークレットも消えるが、D1 は残る
- `wrangler secret put`・`secret list` には `--env=""` を付けて、`wrangler.jsonc` の先頭の設定を選ぶ。付けないと、`env.e2e` があるので警告が出る（`d1 execute` は警告しない）。値をパイプで渡すと末尾の空白が削られるので、`BETTER_AUTH_SECRET` は `openssl rand -base64 32` からパイプで入れ、画面に出さない（[secrets.md の「本番: wrangler secret put」](../runbooks/secrets.md#本番-wrangler-secret-put)）
- `apps/api/.dev.vars.example` は、`secrets.required` の名前を値なしで並べたひな形（`BETTER_AUTH_URL` だけは手元の URL が入る）。`.gitignore` で戻している。名前が `wrangler.jsonc` とずれたり、シークレットに値が入ったりすると、`dev-vars-example.test.ts` が落ちる
- `host_allowlist.github_user_id` は TEXT の列。`'12345'` と文字列で書く。数で書くと `account.account_id` と合わない（[host-allowlist.md](../runbooks/host-allowlist.md)）
- 本番の D1 は `--update-config=false` を付けて作る。付けないと、`wrangler.jsonc` に足すかを聞かれ、既定が yes なので D1 の ID がリポジトリに入ってしまう（[README の「本番の環境を一から作る」](../../README.md#本番の環境を一から作る)）

## 本番の環境

- 本番は `https://zubakui-web.xeikit-app.workers.dev`。D1 は APAC の `zubakui`。2026-10-18 に README の手順で作った
- デプロイのあとの確かめ（state とセッションの Cookie、ホストの WebSocket の Cookie、CSP、通しの1回、tail と Observability）は、[deploy.md の「デプロイのあとに確かめる」](../runbooks/deploy.md#デプロイのあとに確かめる)にある
- それぞれの Worker がどのコミットで動いているかは、`Deploy API Worker`・`Deploy web Worker` の step が成功した、いちばん新しい deploy.yaml の run から読む（同じ節の 0）。`production` の Deployment の一覧からは読まない。Deployment は job ごとに作られ、その job が失敗しても残るため。タグの上で動かした run（v1.3.0 までの Release の run を含む）があるので、`--branch` で絞らない。v1.3.0 までの `web` の run では API の step が `skipped` になるので、step ごとに読む

## ルールセット

手順と、それぞれの設定の理由は [branch-protection.md](../runbooks/branch-protection.md) にある。

- `docs/runbooks/main-ruleset.json` は、main のルールセットを `gh api -X POST .../rulesets --input` にそのまま渡せる形で書いたもの。`id`・`_links` など、GitHub が付ける項目は入れない
- `main-ruleset.test.ts` は、必須のチェックのどれもが `.github/workflows/` のどれかの job のチェック名（`jobs.<id>.name`、なければ job ID）と合うかを確かめる。テストはチェックの名前を決め打ちしない。その workflow が main への PR と push の両方で動くことも確かめる。デプロイの `verify-ci` が、main のコミットでチェックを探すため
- `storybook.yaml` の `storybook` は、部品の目録（Storybook）のビルドが通るかを、`ci.yaml` と同じきっかけ（main への PR と push）で確かめる。必須のチェックには入れない。仕様書のビルドの不調で、本番の修正の PR まで止めないため。secrets も `github.token` も読まず、権限は `contents: read` だけにする。書き出した `storybook-static` は公開しないので、artifact にも残さない（[frontend.md の「Storybook」](frontend.md#storybook)）。手元では2秒ほどで終わる（2026-11-08）。`ci-workflow.test.ts` が、必須に入っていないことと、権限と secrets を確かめる
- `docs/runbooks/release-tag-ruleset.json`（ルールセットの名前は `release-tags`）は、`refs/tags/v*` の `creation`・`update`・`deletion` を禁じ、bypass をリリースの App（`actor_type: Integration`、`bypass_mode: always`）1つだけにする。この App の token を持つのは deploy.yaml の `release` だけ（ADR 0012）。`update` には `parameters` を付けない。GitHub は `update_allows_fetch_and_merge` を受け付けたうえで捨てるので、書き出した設定と合わなくなる（2026-10-28 に確かめた）
- `actor_id` は App の設定画面の About に出る App ID（5496985）で、Client ID ではない。非公開の App は `gh api apps/<slug>` でも `performed_via_github_app` でも読めないので、`release-tag-ruleset.test.ts` は形だけを確かめ、値は確かめない
- タグのルールセットは、production に `v*` のタグを許すより前に作る。逆の順だと、その間は書き込みの権限があれば誰でも、好きなコミットにタグを打って本番に出せる。打ち間違えたタグは、ルールセットを一時的に止めないと消せない（[branch-protection.md の「打ち間違えたタグを消す」](../runbooks/branch-protection.md#打ち間違えたタグを消す)）

## リリース

手順は [release.md](../runbooks/release.md) にある。版はデプロイの dispatch の `bump` で選び、デプロイが成功したコミットにタグと Release を作る（ADR 0012）。v1.3.0 までは release-please のリリース PR で版を決め、できた Release でデプロイしていた（ADR 0009・0010）。

- タグ・Release・CHANGELOG の PR は、deploy.yaml の `release` の job が作る（`needs: [verify-ci, deploy]`・`if: github.ref_type == 'branch'`・`environment: release`）。`deploy` が失敗したとき、Reject したとき、タグの上で動かしたときは動かない。`verify-ci` の outputs を読むので、`verify-ci` も `needs` に書く（直接 `needs` に書いた job の outputs しか読めない）
- 書き込みは GitHub App の token だけが持つ（`actions/create-github-app-token`、`permission-contents: write`・`permission-pull-requests: write`）。`client-id` は `vars.RELEASE_APP_CLIENT_ID`、鍵は `secrets.RELEASE_APP_PRIVATE_KEY` で、どちらも main だけが使える Environment `release` に置く。どの workflow の `GITHUB_TOKEN` にも書き込みを渡さない。App の token を使うのは、`GITHUB_TOKEN` で作った PR では ci / e2e が承認待ちのまま動かないため。ラベルを使わないので、`permission-issues` は渡さない。Workflows の権限（`permission-workflows`）は渡さない。`.github/workflows/` を変えたコミットにも、Release の API でタグを作れた（2026-11-14 に v1.4.0 で確かめた。求められるのは、git の push で workflow のファイルを書き換えるとき）。渡すと、鍵が漏れたときに、main 以外のブランチの workflow を書き換えられるようになる
- `release` は依存パッケージを入れず、`mise-action` で node だけを入れる（`install_args: node`・`cache: false`）。書き込みの token を持つ job で、依存の install スクリプトや、ほかの job が書けるキャッシュの中身が動かないようにする（ADR 0012 の DD2）。そのため、`release` が呼ぶ `tools/release/src/steps.ts` とそれが読み込むファイルは、changelogen も、ほかの npm のパッケージも読み込まない
- 手順は [.github/scripts/release.sh](../../.github/scripts/release.sh) の `publish`。PR を先に、Release をあとに作る。どの手順も、すでにあれば飛ばす
  1. `check-release`: タグ `vX.Y.Z` がデプロイしたコミットにあれば、前の Re-run で終わっているので何もしない。別のコミットにあれば止まる。なく、最新の `v*` タグが基準のタグと違えば止まる
  2. このリポジトリの、そのブランチの PR が、開いているかマージ済みなら、3〜5 を飛ばす。PR があることを「ブランチとファイルは済んだ」印にする。PR ができてから手で直した節を、Re-run で書き戻さないため。閉じただけの PR は数えずに作り直す
  3. main の先頭から `changelog/vX.Y.Z` のブランチを、git の refs の API で切る。すでにあれば使う。ブランチ名は版しか持たないので、PR を作る前に落ちた別の run（別のコミット）が残したものでありうる。そのため、ブランチがあることは「済んだ」印にしない
  4. contents API で `CHANGELOG.md` と `package.json` を書き換える。git で push しないので、checkout に token を残さずに済み、コミットには GitHub の署名が付く。本文は `--input` の JSON で渡す（引数1つの長さには 128KB の上限がある）。中身が変わらなければコミットしない
  5. PR を開く
  6. `gh release create --target "$GITHUB_SHA"` で Release を作り、タグも Release の API に作らせる
- PR を先にするのは、途中で落ちたときに、開いた PR が次の dispatch を承認の前で止めるため。PR を作る前に落ちたときは何も残らず止まらないので、runbook の手順で Re-run する
- `CHANGELOG.md` は、`steps.ts` の `changelog`（`prependNotes`）が、見出し（`# Changelog`）のすぐ下に節を足す。同じ版の節（その見出しから次の `## ` の手前まで）がすでにあれば、今回の文面で置き換える。中身が同じなら結果も変わらないので、Re-run で2回足さず、残ったブランチが別の run の文面のままにもならない（CHANGELOG の PR と Release の文面がずれない）。`release` は oxfmt を動かさないので、`.oxfmtrc.json` は `CHANGELOG.md` を飛ばす。v1.3.0 までの節は release-please が書いた形（日本語の見出し、空行が3つ続く形）のまま残す
- ルートの `package.json` の `"version"` は `"name"` のすぐ下に置く。`setPackageVersion` は、いちばん外の `"version"` の値だけを書き換え、ないと止まる。`release-workflow.test.ts` が確かめる
- 開いた CHANGELOG の PR は、ブランチが `changelog/` で始まることで見分ける（`guard.ts` の `changelogPr`）。`release.sh` の `gh pr list` は、fork からの PR（`isCrossRepository`）を数えない。誰でも同じ名前のブランチの PR を開けるので、数えると dispatch を止めたり、CHANGELOG の PR を作らずに飛ばさせたりできてしまう（`release-workflow.test.ts`）。題名は scope のない `chore: vX.Y.Z の CHANGELOG を更新する` で、`guard.test.ts` が commitlint に通す
- マージを squash だけにしているのは、マージコミットだと本文に PR の題名とコミットの一覧が入り、どの変更も2回ずつ数えられるため（ADR 0009）

### 版の判定と文面（tools/release）

ADR 0012 の流れで、deploy.yaml の3つの job が、版と文面を決め、続けるか止めるかを決めるための道具。

```sh
node tools/release/src/cli.ts --bump auto --to <コミット>
```

- 出力は1行の JSON（`baseTag`・`next`・`reason`・`notes`）。`next` は `v` を付けない `x.y.z`。GitHub の `$GITHUB_OUTPUT` やまとめへの書き方は、呼ぶ側のシェルが決める。手元で動かせば、承認の前に出る版と文面を下見できる
- 終了コードは、版が決まれば 0、`next` が `null`（auto で上げるものがない、`v*` のタグがない）なら 1、引数の誤りなら 2。1 のときも JSON を出し、理由を標準エラーにも書く
- 基準は、`git tag --list 'v*'` のうち版がいちばん大きいタグ（`latestTag`）。`vX.Y.Z` の形でないタグは数えず、版は数で比べる（`v1.10.0` は `v1.9.0` より大きい）。タグが1つもなければ、取り忘れ（`fetch-depth: 0` など）とみなして止まる
- 次の版は自前の純粋関数 `plan` が決める。changelogen の `bumpVersion` は、上げるものがなくても patch に落ち、docs なども patch に数え、基準が `package.json` になるので使わない。auto は、破壊的変更があれば major、feat があれば minor、fix か perf があれば patch、どれもなければ `null`。major・minor・patch を選べば、commit がなくてもその分だけ上げる
- 版の判定と文面には、同じ commit（`selectCommits`）を使う。CHANGELOG に出さない type の破壊的変更（`chore!:` など）では版を上げない。上げた理由が文面に出ないため
- changelogen はライブラリとして、commit の解析（`parseCommits`）と文面づくり（`generateMarkDown`）だけに使う。CLI が中でしている「types にない type や `false` の type を捨てる」は、ライブラリでは効かないので `selectCommits` でする。しないと `false` の type が `### undefined` の見出しで出る
- commitlint は、`Revert "…"`・`Reapply "…"`・`fixup!`・`squash!`・`amend!`・`Merge pull request …` などの題名を確かめずに通す（`@commitlint/is-ignored` の既定）。changelogen の正規表現は先頭に固定されていないので、そのままだと途中の `feat:` を拾って minor に上げる。そのため `selectCommits` は、`Revert "feat: x (#1)" (#2)` を `revert: feat: x (#1) (#2)` に、`Reapply "feat: x (#1)" (#2)`（取り消しの取り消し）を `feat: x (#1) (#2)` に書き換え、それでも先頭が `type(scope)!: ` の形でない題名は捨てる
- 本文のフッターの `BREAKING-CHANGE:` は `BREAKING CHANGE:` に書き換えてから読む。Conventional Commits は2つを同じ意味とするが、changelogen は空白のほうしか拾わない。squash の本文は空にする決まりなので、ふつうは題名の `!` で表す
- `generateMarkDown` は、`noAuthors` でも、名前のある作者ごとに `https://ungh.cc/users/find/<メール>` へ問い合わせる。`selectCommits` は作者を消して渡す
- `--to` は、changelogen の `getGitDiff` がシェルの文字列（`git log "基準...to"`）に埋め込むので、英数字と `._/-` だけを受け付ける。`基準...to` は対称差なので、基準のタグが `--to` の祖先でないと、基準の側にしかない commit も混ざる。祖先かどうかは `verify-ci` が確かめる
- 出す type と見出しは、ルートの `changelog.config.ts` にある（feat・fix・perf・refactor・docs・revert。見出しは changelogen の既定で、既定の表にない revert だけを足す。chore・ci・test・build・style と、既定の表の `types`・`examples` は `false`）。`notes.test.ts` が、`commitlint --print-config` のどの type にも出すか `false` かの決まりがあることと、見出しの並びを確かめる。changelogen を上げて既定の見出しが変わったら、ここで気づく
- 続けるか止めるかの判定は、`guard.ts` の純粋関数にする。読み出しは `steps.ts`（git）と `release.sh`（`gh`）が行い、判定には事実だけを渡す。`guard.test.ts` が、ADR 0012 の止める・飛ばす条件をすべて確かめる。`steps.test.ts` は、一時フォルダーに本物の git のリポジトリ（注釈付きのタグを含む）を作って `steps.ts` を動かす
  - `checkPlan`（`verify-ci`）: 基準のタグが出すコミットを指している、祖先でない、前の CHANGELOG の PR が開いている
  - `checkDeploy`（`deploy` の最初）: 最新の `v*` タグが基準のタグと違う、前の CHANGELOG の PR が開いている。祖先かだけを確かめ直すのでは、同じコミットが先に別の番号で出されたあとに、古い番号の版を作りうる
  - `checkRelease`（`release` の最初）: タグがデプロイしたコミットにある → 飛ばす、別のコミットにある → 止める、最新のタグが基準のタグと違う → 止める
- `steps.ts` が git に渡すタグ・SHA・版は、`vX.Y.Z`・40桁の小文字の16進・`x.y.z` の形だけを受け付ける。ref の書き方（`^{commit}` など）やオプション（`-`）として読まれないようにする
- `files.ts` の `releaseBody` は、Release の題名と重なる版の見出し（`## vX.Y.Z`）を外して、Release の本文にする
- changelogen はルートと `tools/release` の両方に、同じ版で入れる。ルートは `changelog.config.ts` の型のため（`commitlint.config.ts` と `@commitlint/types` と同じ形）。changelogen は 0.x なので、上げるたびに API の変化と `@deprecated` を確かめる

## デプロイの workflow

手順は [deploy.md](../runbooks/deploy.md) にある。

- 本番のデプロイは `.github/workflows/deploy.yaml` からだけ行う。手で動かす `workflow_dispatch` だけで動き始め、欄は `bump`（auto / major / minor / patch、既定は auto）だけ（ADR 0012）。`release: published` のきっかけと `target`（`web` / `all`）の欄はなくした。いつも全体（マイグレーション → API → 画面）を出す
- ブランチの上の run は版を決めて `release` まで動き、タグの上の run（出し直す・前の版に戻す）は版を決めず `release` も動かない。分け目はどれも `github.ref_type == 'branch'` で書く。タグの上の run は、そのタグのコミットの deploy.yaml で動く。v1.3.0 までのタグの deploy.yaml には `target` の欄があり、既定が `web` なので、戻すときは `all` を選ぶ
- job は `verify-ci` → `deploy` → `release` の3つ。`environment: production` を使うのは `deploy` だけで、Cloudflare のトークンとアカウント ID もそこにしかない。`deploy` は、マイグレーション → API → 画面の順に step を行う。status の関数を書かない step の `if` は `success() && …` と同じなので、どれかの step が失敗するとその後ろは動かない
- `deploy` の最初の確かめ直し（`Recheck release base`、`release.sh guard`）は、ブランチの上の run で、`pnpm install` と、Cloudflare の secret を読むどの step よりも前にある。**Re-run failed jobs** は成功済みの `verify-ci` を動かし直さないので、古い run の Re-run を本番に出す直前に止める。`deploy-workflow.test.ts` が位置を確かめる
- `verify-ci` の outputs（基準のタグ・版・文面）は、`run:` に `${{ }}` で埋め込まず、step の `env` で渡す。文面は commit の題名を含むので、`notes-base64` として base64 の1行にする。複数行の値を `$GITHUB_OUTPUT` に書く区切りの文字列を、題名で終わらせられないようにする
- `production` が許すのは、main ブランチと `v*` のタグだけ（`deployment-branch-policies`、`v*` は `type: tag`）
- `production` には Required reviewers（自分、`prevent_self_review: false`、`can_admins_bypass: false`）を付けている（ADR 0009）。承認は `production` を使う job ごとに求められる（2026-10-27 に、job を3つに分けていたころの `all` で確かめた。ドキュメントには書かれていない）。`production` を使う job を1つにしているので、承認は1回で済む（ADR 0010 の E3）。`deploy` を job に分け直さない。承認だけの job を先頭に置いて reviewers を外す形にもしない。トークンを持つ Environment から reviewers が外れてしまう
- Reject すると何も出ず、何も作られない。**Re-run failed jobs** は失敗した job をはじめからやり直す（当て済みのマイグレーションは飛ばされる）。`release` だけが落ちたときは、`release` だけが動き直す。Re-run は、いちばん新しい run にだけ使う。新しい run の `release` が PR を作る前に落ちた状態では、古い run の Re-run を `deploy` の確かめ直しで止められない（ADR 0012）
- `timeout-minutes` は `deploy` が 30、`verify-ci` が 35、`release` が 10。`verify-ci` は `CI_WAIT_SECONDS`（1800 秒）より長くしておく。短いと、どのチェックを待っていたかを書かずに時間切れで止まる。テストがこれを確かめる
- `concurrency` は GitHub の既定のまま（待てる run は1つ）。新しい run が来ると、待っている run は取り消される。承認を待っている run も、動いている1つに数えられる（#172 で、2026-10-31 に確かめた）。1つずつ動くので、次の run が版を数えるのは、前の run の `release` がタグを打ったあとになる。`queue: max` は足さない。並んだ順に動く保証がなく、古いコミットが最後に出ることがある
- step はルートの `db:migrate:remote`・`deploy:api`・`deploy:web` を呼ぶ。API のものは `--env=""` を付ける。画面の `deploy` は `vite build && wrangler deploy` で、E2E のビルドが残した設定を使わない（[testing.md の「本番と同じビルドで動かす」](testing.md#本番と同じビルドで動かす)）

## verify-ci

- `verify-ci` の job は `permissions: contents: read, checks: read, pull-requests: read` で、Environment もシークレットも使わない。版を決めるのでタグと履歴ごと checkout し（`fetch-depth: 0`）、ブランチの上の run でだけ、mise（`cache: false`）と `@zubatto-quiz/release` の依存を入れる。出した版と文面は App の token を持つ `release` に渡るので、`ci` と `e2e` が書けるキャッシュは読まない
- ブランチの上の run では、CI を待つ前に版を決める（`release.sh plan`）。上げるものがない auto では、CI を 30 分待たずに止まる。`tools/release/src/cli.ts` が版と文面を出し、`steps.ts check-plan` が続けられるかを確かめる。基準のタグ・版・理由・文面は `$GITHUB_STEP_SUMMARY` に書き、outputs で渡す
- スクリプトは、はじめにコミットが main にあるかを `gh api repos/…/compare/main...$GITHUB_SHA --jq .status` で確かめる。`identical` か `behind` なら通り、`ahead` か `diverged` なら止まる。こうすると、履歴を全部チェックアウトしなくて済む
- 次に、ルールセットの必須のチェック（`ci`・`e2e`・`pr-title`）を、`CI_POLL_SECONDS`（30）秒ごとに、すべてが `completed`/`success` になるまで見る。チェックは、その `integration_id` を `app_id` にして絞り、`GITHUB_SHA` の上のいちばん新しい check run を読む。名前はルールセットから読み、workflow には写さない
- 終わって成功でないものがあれば、すぐに止まる。まだ終わっていないもの（`queued`・`in_progress`・`waiting`・`requested`・`pending`）と、まだ見つからないもの（`not_found`）と、`gh api` の読み出しの失敗（`api_error`）は、`CI_WAIT_SECONDS`（1800）まで待つ。マージの直後に動かした run は、main の CI が走っている間に始まるため（ADR 0010 の Q1）
- `api_error` は `if ! result=$(…)` で捕まえる。こうしないと、GitHub の 5xx が1回あっただけで、`set -e` で待つのをやめてしまう。`CI_WAIT_SECONDS` と `CI_POLL_SECONDS` は step の `env` で渡し、スクリプトは `:?` で必須にしている
- PR の CI は `refs/pull/N/merge` の上で動くので、main に入ったコミットにはチェックが付かない。そのため `ci.yaml` は main への push でも動く
- シェルでは、全角の文字が続く変数を `{}` で囲む（`${result}）`）。bash は、マルチバイトの文字のバイトを変数名の一部として読むことがある

## action の固定

workflow が使う action は、GitHub 公式の lockfile `.github/workflows/actions.lock` で固定する。`gh actions-lock` が書く生成物なので、手で直さない。

- lock は、action ごとにコミットとリポジトリの ID を持つ。action が内部で呼ぶ action まで入る。実行するときは、lock のコミットが使われる
- `uses:` はタグの全桁（`actions/checkout@v7.0.1`）で書く。SHA は lock にあるので、`uses:` には SHA も版のコメントも書かない。SHA で書いてあっても、`gh actions-lock` がタグに書き換える（v0.4.1 で、2026-11-05 に確かめた）
- `v7` のような短いタグや `main` のようなブランチは使わない。lock の `commit` をその ref の履歴にある古いコミットへ戻しても、`--verify` は通す（全桁のタグなら `tag-commit-mismatch` で止まる）。上流が ref を戻したときは、`commit` が ref の履歴から外れれば `unreachable-pin` で止まるが、履歴に残れば気づけない。`--no-narrow` で作った lock や `@main` は `--verify` を通るので、`ci-workflow.test.ts` で止める
- ローカルの `./` の action と、外部の再利用する workflow（`jobs.<id>.uses`）は lock に入らない。今はどちらも使っていない。外部の再利用する workflow は、タグでも `@main` でも存在しないファイルでも `--verify` を通るので、`ci-workflow.test.ts` で止める（v0.4.1 で、2026-11-05 に確かめた）。使うときは README の Limitations を読む

実行時に runner がどこまで止めるかと、`--verify` の結果は、次のとおり（公開リポジトリの Free プランで、#248 と #252 で、2026-11-05 に確かめた）。runner が止めないものがあるので、必須チェック `ci` の中で `--verify` を動かし、PR では lock の差分も読む。`--verify-local` は古いコミットへのすり替えを通すので使わない。

| lock の状態                             | runner の動き                                                                                 | `--verify` | `--verify-local` |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- | ---------------- |
| 合っている                              | lock のコミットで動く（ログに `Using locked action versions` と出る）                         | 通る       | 通る             |
| `commit` が存在しない SHA               | `Set up job` で止まる                                                                         | 止まる     | **通る**         |
| `uses:` を変えて lock を直していない    | 動き始めない（`startup_failure`。job ができないので `ci` のチェックが付かず、マージできない） | 止まる     | 止まる           |
| `commit` がタグの履歴にある古いコミット | **止まらない。そのコミットで動く**                                                            | 止まる     | **通る**         |
| workflow が lock に載っていない         | **止まらない。タグが指すコミットで動く**（ログに `Using locked` が出ない）                    | 止まる     | 止まる           |

action を足す、更新する、または workflow を足すときの手順は次のとおり。

1. 拡張を版を指定して入れる（初回だけ）: `gh extension install github/gh-actions-lock --pin v0.4.1`
2. `uses:` を直す
3. `gh actions-lock` を動かす。全部の workflow を読むので、ファイルは指定しない
4. `git diff .github/workflows/` で、lock の `commit` と `ref` の変わり方を読んでから、workflow と一緒にコミットする

`tag-commit-mismatch`（lock のコミットが、タグの履歴の古いコミット）か `unreachable-pin`（lock のコミットが、タグの履歴にない）と出たときは、タグが動かされたか、lock が書き換えられた。`unreachable-pin` は、上流が force-push や squash で履歴を書き換えたときにも出る。ツールには見分けられないので、そのまま受け入れない。

1. main の lock と比べる。書き換えられていたら、main のものに戻す
2. 上流のリリースノートと履歴を読み、コミットが変わった理由を確かめる。`tag-commit-mismatch` なら2つのコミットの差も読む。履歴の書き換えで古いコミットと比べられないときも、リリースノートと履歴で理由の説明がつかなければ受け入れない
3. 問題がなければ、`tag-commit-mismatch` は `--relock` で、`unreachable-pin` は `--accept-moved` で受け入れ、差分を読む。どちらも自動の処理では使わない

### ci で落ちたとき

`ci` は Checkout の直後に `Install gh-actions-lock` と `Verify actions.lock` を動かす。`GH_TOKEN` はこの2つの step にだけ `github.token` を渡す（権限は `contents: read` で足りる）。`pnpm install` より前に動くので、依存パッケージのコードはトークンを読めない。拡張の版を上げるときは、`ci.yaml` と上の手順の `--pin` をそろえる。

どこで、何と出て落ちたかで直し方が変わる。

| 落ち方                                                                            | 直し方                                                                                                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| どちらかの step が `TLS handshake timeout` などの通信のエラーか、時間切れで落ちる | lock のずれではない。`gh run rerun <run の ID> --failed` で再実行する                                                               |
| CI の run が `startup_failure` で、`ci` のチェックが付かない                      | 手元で `gh actions-lock --verify` を動かして理由を読む。多くは次の行と同じ                                                          |
| `Ref changed`・`Not pinned`・`Unused lockfile entry`（`uses:` と lock のずれ）    | 手元で `gh actions-lock` を動かし、差分を読んでから、workflow と一緒にコミットする                                                  |
| `tag-commit-mismatch`・`unreachable-pin`（lock のコミットが上流と合わない）       | そのまま受け入れない。上の手順で、書き換えられていないかと、コミットが変わった理由を確かめる                                        |
| `ci-workflow.test.ts` の `usesThatVerifyMisses` で落ちる                          | action は `uses:` を全桁のタグに直す。コンテナ（`docker://`）は `@sha256:` を付けても使わない。外部の再利用する workflow も使わない |

通信の不調は、#252 で2回目の実行で1回起きた（`api.github.com` の `TLS handshake timeout`。1つの step に9分20秒かかった）。そのときは Checkout も4分半かかっており、同じコミットの `e2e` は別の runner で通り、再実行は8秒で終わった。そのため、自動の再試行は入れず、2つの step を `timeout-minutes: 3` で区切って、早く落として再実行する。再実行で足りないほど増えたら、やり方を考え直す。

`main` への push でも動くので、上流がタグを動かすと、PR がなくても `main` の `ci` が落ち、`verify-ci` がデプロイを止める。`main` で落ちたときも同じ表で直す。

### mise の版とキャッシュ

`actions.lock` が固定するのは `jdx/mise-action` のコードで、action が動くときに取ってくる mise 本体は固定しない。そのため、mise 本体は `with.version` で固定し、`deploy` ではキャッシュも読まない。どちらも `ci-workflow.test.ts` が確かめる。

- 版を書かないと、`cache_max_age_days`（既定で30日）でキャッシュの鍵が変わるたびに、公開から24時間たった最新の mise に入れ替わる。リポジトリに差分がなくても `ci` と `deploy` で動くものが変わり、PR のレビューも `cooldown` の3日も通らない（2026-11-07 に上流の README で確かめた）
- `deploy` は `cache: false` にする。`main` への push で動く `ci` と `e2e` は、依存パッケージのコードを動かし、同じ鍵のキャッシュに書き込める。ここで作られたツールを復元すると、そのツールが Cloudflare のトークンを扱うことになる。上流の README も、成果物を公開する job ではキャッシュを復元しないように書いている
- その代わり、`deploy` は毎回ツールを取り直すので、GitHub やツールの配布元の不調で `Install tools via mise` が止まることがある。トークンを守るほうを選び、この弱点は受け入れる。止まったときは [deploy.md](../runbooks/deploy.md#失敗したとき) のとおり再実行する

Dependabot は `uses:` だけを更新し、`with.version` は更新しない。mise を上げるときは、手で次のように行う。

1. [mise のリリース](https://github.com/jdx/mise/releases)から、公開から3日以上たった版を選び、リリースノートを読む
2. `with.version` をすべての workflow で同じ版に直す
3. `ci` と `e2e` が通ることを PR で確かめる。`deploy` の動きは PR では確かめられないので、マージのあとの最初のデプロイで見る

## Dependabot での更新

action と npm の依存の更新は、Dependabot が週に1回 PR にする（`.github/dependabot.yml`）。自動マージはしない。`.mise.toml`（node・pnpm・shellcheck・uv の版）は Dependabot が読まないので、手で更新する。

### action の更新

[上の「action の固定」](#action-の固定)の手順を手で行うのは、action を足すときと、Dependabot を待たずに更新するときだけ。

- lock に載っている workflow なら、Dependabot は `uses:` と一緒に `actions.lock` も同じ PR で作り直す。設定は要らない（[GitHub の文書](https://docs.github.com/en/actions/how-tos/secure-your-work/lock-workflow-dependencies)で、2026-11-06 に確かめた）。lock に載っていない workflow は `uses:` だけが変わるので、workflow を足すときは必ず `gh actions-lock` まで動かす
- `commit-message.prefix` は `ci` にする。squash マージなので PR の題名が `main` のコミットになり、`pr-title` の commitlint を通す必要がある。`ci` は CHANGELOG に載らず、版も上がらない。`include: scope` は書かない。書くと `ci(deps):` になり、scope を付けない決まりから外れる
- minor と patch は1つの PR にまとめる。PR ごとに `e2e` が約10分かかるので、数を減らす。major は action ごとの PR に分ける。`deploy.yaml` は PR の CI で動かないので、壊れる更新はマージのあとで初めて分かる。分けておけば、原因の action をすぐ切り分けられる
- `cooldown.default-days` は3日にする。乗っ取られて新しいタグが公開されると、そのタグは `--verify` を通る。`--verify` が止めるのは、すでにあるタグが動いたときだけだからだ。公開から数日待って、見つかるまでの時間を稼ぐ。github-actions では `semver-major-days` などの版ごとの設定は使えない
- 更新の PR の GitHub Actions は `GITHUB_TOKEN` が読み取りだけになり、読める secrets は Dependabot secrets だけになる（今は0件）。本番の secrets は `production` 環境にあるので、更新された action のコードが PR の CI で動いても届かない。`pull_request_target` と `workflow_run` は使わない

更新の PR で読むことは次のとおり。

1. `actions.lock` の差分で、`ref` と `commit` が更新した action の分だけ変わっていること。`owner_id` と `repo_id` が変わっていたら、リポジトリの持ち主が変わった可能性があるので、そのままマージしない
2. `deploy.yaml` が使う action（`actions/create-github-app-token` など）なら、上流のリリースノートを読む。必須チェックが通っても、deploy.yaml の中での動きは確かめられていない
3. `ci` の `Verify actions.lock` が `tag-commit-mismatch` か `unreachable-pin` で落ちたら、[上の手順](#ci-で落ちたとき)で理由を確かめる
4. PR の題名を、日本語の subject に直してからマージする（例: `ci: mise-action と upload-artifact を更新する`）。`commit-message.prefix` で決められるのは `ci` までで、subject は英語のまま届く。`pr-title` の commitlint は subject の言語を見ないので、直さなくても通り、そのまま `main` のコミットになる

### npm の依存の更新

- 依存はすべて完全固定にする。`pnpm add` が `^` を付けないよう、`pnpm-workspace.yaml` に `saveExact: true` を書く。pnpm 11 からは `.npmrc` の認証とレジストリ以外の設定を読まないので、`.npmrc` の `save-exact=true` は効かない（[pnpm の文書](https://pnpm.io/settings) と手元の 12.11.0 で、2026-11-07 に確かめた）。`saveExact` が効くのは `pnpm add` だけなので、手で書いた範囲の指定は `pnpm-exact-versions.test.ts` が止める
- `directory` は `/` だけにする。`pnpm-lock.yaml` は root に1つだけで、pnpm は `.mise.toml` と同じ 12 系まで Dependabot が対応している（[GitHub の文書](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories)で、2026-11-07 に確かめた）
- `commit-message.prefix` は `chore` にし、`include: scope` は書かない。理由は action の `ci` と同じ。`chore` は版を上げないので、更新は次のリリースで本番に届く。脆弱性を直す更新をすぐ本番に出したいときは、PR の題名を `fix:` に書き換えてからマージする
- minor と patch は `minor-and-patch` の1つの PR にまとめ、ほかの major はパッケージごとの PR にする。`storybook`・`react`・`tailwindcss`・`commitlint` は版をそろえて動くので、major のときだけ一緒に別の PR にする。minor と patch まで分けないのは、グループの数だけ PR と `e2e` が増えるからだ。グループは先に一致したものに入るので、`minor-and-patch` を最後に書く
- 手で直すことがあるものは、minor と patch でも `minor-and-patch` から外し、直し方ごとのグループにする。1つにまとめると、その1件のために毎週の PR が `tsc` で止まり、ほかの更新のテストの結果が見えない。直すために手で push すると Dependabot が自動で rebase しなくなるので、手を入れる PR は小さいほうがよい
  - `cloudflare`（`wrangler`・`@cloudflare/*`、major も含む）: `wrangler` はほぼ毎週新しい版が出て、そのたびに `worker-configuration.d.ts` の作り直しが要る（[下の3番](#更新の-pr-で読むこと)）。`@cloudflare/vite-plugin` と `@cloudflare/vitest-plugin` も workerd を持つので、型を作る版とテストを動かす版がずれないよう一緒に上げる
  - `oxc`（`oxlint`・`oxfmt`）: 整形の変わり方や新しいルールで、リポジトリ全体に直しが出ることがある（下の4番）
- `cooldown` は `default-days` を3日、`semver-major-days` を7日にする。公開直後の版を避け、[pnpm の公開待ち期間](#pnpm-の公開待ち期間)に引っかからないようにする
- `@babel/core`・`@types/node`・`typescript` の major は `ignore` で止め、手で上げる。`@babel/core` は 8 系にすると React Compiler が既定値付き props の部品を黙って飛ばす（[frontend.md の「全体の形」](frontend.md#全体の形)）。`@types/node` は `.mise.toml` の Node の版に合わせる。`typescript` は 7.0 に API がなく、新しい API は 7.1 で出る予定なので（[TypeScript の告知](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)で、2026-11-07 に確かめた）、7.1 が出たら `ignore` を外す。このリポジトリの `tsc` と commitlint は 7.0.2 でも動いたので、今の失敗を避けるためではなく、API が整うのを待つための `ignore` だ
- Dependabot alerts はオンにしている（2026-11-07 に `gh api -X PUT repos/XeicuLy/zubatto-quiz/vulnerability-alerts` で有効にした）。security updates はオフのままにする。`cooldown` が効かないので、公開待ち期間に引っかかりやすい。pnpm 12 の lockfile を依存グラフが読めていることは、`gh api repos/XeicuLy/zubatto-quiz/dependency-graph/sbom --jq '.sbom.packages | length'` の件数で確かめる（2026-11-07 は850件）

#### pnpm の公開待ち期間

pnpm には、公開から1440分（1日）たっていない版を避ける `minimumReleaseAge` が組み込まれている（[pnpm の文書](https://pnpm.io/settings/dependency-resolution#minimumreleaseage) と手元の 12.11.0 で、2026-11-07 に確かめた）。`pnpm config get minimumReleaseAge` は `undefined` と答えるが、これは「書かれていない」という意味で、組み込みの値は効いている。

`pnpm-workspace.yaml` には、この値も `minimumReleaseAgeExclude` も `trustLockfile` も書かない。値を明示すると `minimumReleaseAgeStrict` の既定が変わり、ほかの2つは守りを素通りする。`dependabot.test.ts` がこの3つを止める。

| 起きること                                          | pnpm の動き                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 範囲の指定（`^1.0.0`）で、最新の版が公開から1日以内 | 1つ前の版を選ぶ。何も足されない                                                       |
| 新しすぎる版を明示する                              | 入れたうえで、`pnpm-workspace.yaml` に `minimumReleaseAgeExclude` を黙って足す        |
| 除外がないのに、lockfile に新しすぎる版がある       | `pnpm install --frozen-lockfile` が `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` で落ちる |

`cooldown` が効くのは、PR で上げる直接の依存だけだ。lockfile を作り直すときに公開直後の推移的な依存が入ると、3行目のとおり `ci` が落ちる。これは設定では防げない。

#### 更新の PR で読むこと

1. `pnpm-workspace.yaml` が変わっていないこと。`minimumReleaseAgeExclude` が足されていると `dependabot.test.ts` で `ci` が落ちる。その PR はマージせず、1日以上たってから `@dependabot recreate` とコメントして作り直す
2. `ci` が `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` で落ちたら、除外を足さない。名前の出た版が公開から1日たつのを待ち、`ci` を再実行する
3. `wrangler` を上げる PR（`cloudflare` のグループ）は、`ci` の `tsc` が `Types at worker-configuration.d.ts are out of date` で落ちる。`wrangler types --check` は生成ファイルの workerd の版まで比べるのに、Dependabot はこのファイルを作り直さないからだ。PR のブランチで次の2つを動かし、できたファイルをコミットする。手で push すると Dependabot は自動で rebase しなくなるので、`pnpm-lock.yaml` を変えるほかの PR より先にマージする。`ci` は `tsc` で止まり、`test` がまだ動いていないので、push のあとの `ci` まで見る

   ```sh
   pnpm --filter @zubatto-quiz/api run types
   pnpm --filter @zubatto-quiz/web run types
   ```

4. `oxc` の PR が `ci` の `fmt:check` で落ちたら、PR のブランチで次を動かし、整形の差分をコミットする。`lint` で落ちたら、新しいルールの違反を直す。どちらも push すると自動の rebase が止まるのは3番と同じ

   ```sh
   pnpm run fmt
   ```

5. major の PR なら、上流のリリースノートを読む。`react` や `tailwindcss` は、テストが通っても見た目が変わることがある
6. PR の題名を、日本語の subject に直してからマージする（例: `chore: minor と patch の依存を更新する`）。理由は [action の更新](#action-の更新)の4番と同じ
7. npm の最初の PR では、`pnpm-lock.yaml` の `importers` の差分で、root だけでなく `apps/*`・`packages/*`・`tools/*` の依存も更新されていることを確かめる。`dependabot.yml` は `main` に入るまで動かないので、マージの前には確かめられない

#### 手で上げるとき

依存は完全固定なので、`pnpm update` だけでは直接の依存の版は動かない。`pnpm update -L` は動くが、`ignore` と `cooldown` は Dependabot の設定なので効かない。すべてを最新にするので、`@babel/core` は 8 系に、`typescript` は 7 系になる（手元の 12.11.0 で、2026-11-07 に確かめた）。Dependabot を待てないものだけを、名前と版を指定して上げる（例: `pnpm -r update zod@4.6.7`）。どれが古いかを見るだけなら `pnpm outdated -r` を使う。

## ログ

本番中と本番のあとのログの見方と残し方は、[logs.md](../runbooks/logs.md) にある。ここには、手順に出てこない作りの理由を書く。

- `logs:api`・`logs:web` は `wrangler tail --env="" --format json` を動かす。外側の `pnpm -s` とスクリプトの中の `pnpm --silent` の両方で、pnpm 自身の出力をファイルに入れない。ファイルへは `>>` で書く。`>` は同じ名前のファイルを空にするので、tail を動かし直したときに前のログが消える
- `wrangler tail` と `wrangler delete` は `wrangler.jsonc` を読み、E2E のビルドが残す `.wrangler/deploy` の転送は読まない（転送を読むのは `deploy`・`versions`・`triggers deploy`・`preview` だけ）。E2E のビルドのあとでも、本番の Worker の tail を取れる
- tail でも Workers Logs でも、`cookie` は `REDACTED` になり、クエリは `redact_query_string` で消える。`cf-connecting-ip`・`x-real-ip`・`cf-ipcountry` は残り、それだけを消す設定はない。ADR 0005 はこれを受け入れた（#98、[logs.md の「ログに残るもの・残らないもの」](../runbooks/logs.md#ログに残るもの残らないもの)）
- `invocation_logs` は有効のままにする。止めると、残るのは 500 と例外だけになる（ADR 0005）
- アプリは自分の `console.*` を持たない。Hono の既定の `onError` が、500 のときに `console.error` を出す。WebSocket の `canceled` で `exceptions` が空のものは、端末の側から切れただけで、エラーではない

## 文書と workflow のテスト

`tools/docs-check`（vitest の project `docs`）は、文書・設定・workflow が、リポジトリの今の形とずれていないかを確かめる。

| テスト                           | 確かめること                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `links.test.ts`                  | `test/documents.ts` に並べた文書の相対リンクと `#見出し` が、リポジトリの中を指し、GitHub の見出しの slug で解決できること                                                                                                                                                                                                                                                                                                                |
| `scripts.test.ts`                | 同じ文書の `pnpm [-s] [--filter <pkg>] run <script>` が、あるスクリプトを指すこと。`logs:api`・`logs:web` が `pnpm --silent` で始まり、ファイルへ `>>` で残すこと                                                                                                                                                                                                                                                                         |
| `docs-index.test.ts`             | `docs/README.md` の ADR の一覧に、どの ADR もちょうど1行あり、状態が ADR の Status と合うこと                                                                                                                                                                                                                                                                                                                                             |
| `main-ruleset.test.ts`           | [上の「ルールセット」](#ルールセット)のとおり                                                                                                                                                                                                                                                                                                                                                                                             |
| `release-tag-ruleset.test.ts`    | 同じく                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `release-workflow.test.ts`       | [上の「リリース」](#リリース)のとおり（`release` の Environment・needs・if、依存を入れないこと、App の token の権限と持ち主、どの workflow も `GITHUB_TOKEN` に書き込みを渡さないこと、CHANGELOG を oxfmt から外すこと、release-please のファイルが残っていないこと）                                                                                                                                                                     |
| `dev-vars-example.test.ts`       | [上の「インフラの管理」](#インフラの管理)のとおり                                                                                                                                                                                                                                                                                                                                                                                         |
| `ci-workflow.test.ts`            | `run:` に `github.event.*` や `github.head_ref` を `${{ }}` で埋め込んでいないこと。そうした値は `env:` を通す。`ci` が `pnpm install` より前に `--verify` を動かし、トークンをその step にだけ渡すこと。`--verify` が止めない `uses:` の書き方がないこと（[上の「action の固定」](#action-の固定)）。`storybook.yaml` の `storybook` が必須のチェックに入らず、secrets もトークンも読まないこと（[上の「ルールセット」](#ルールセット)） |
| `dependabot.test.ts`             | [上の「Dependabot での更新」](#dependabot-での更新)のとおり（週に1回、題名は scope のない `ci:`・`chore:`、major を分ける、手で直すもののグループ、グループの順番、`cooldown` の下限、手で上げる major、公開待ち期間を弱める設定がないこと、自動マージがないこと）                                                                                                                                                                        |
| `deploy-workflow.test.ts`        | deploy.yaml と ci.yaml を `yaml` で読み、ブランチとタグの上の run と、失敗する job・step・スクリプトごとに、どの job とスクリプトが動くかを試す（`simulate`）。きっかけが `workflow_dispatch` の `bump` だけであること、`production` を使う job が `deploy` だけであること、確かめ直しの step の位置、`run:` に `${{ }}` がないこと                                                                                                       |
| `verify-required-checks.test.ts` | `verify-required-checks.sh` を偽の `gh` と本物の `jq` で、`CI_POLL_SECONDS=0` で動かす                                                                                                                                                                                                                                                                                                                                                    |
| `oxlint-layers.test.ts`          | 一時フォルダーに `.oxlintrc.json` の写しと、import を1行だけ書いたファイルを置いて oxlint を走らせ、`apps/web/src` の層の柵と `import/no-cycle` が効くこと（[frontend.md の「全体の形」](frontend.md#全体の形)）                                                                                                                                                                                                                          |

- `scriptRunsIn` は、スクリプト名を空白かバッククォートの手前まで読む。そのため `logs:web.bak` を `logs:web` とは読まないが、名前のすぐあとの全角の `）` は名前の一部として読む。コマンドは1行に1つずつ書く
- 文書の一覧は `test/documents.ts` にあり、`links.test.ts` と `scripts.test.ts` が共有する。相対リンクや `pnpm run` のコマンドを書く文書を足したら、ここにも足す
- `deploy-workflow.test.ts` の `evaluateIf` は `github.ref_type == '…'` だけを知っていて、知らない形を見ると例外を投げる。job や step の条件を変えたら、`evaluateIf` と `simulate` も広げる
- 偽の `gh` は `PATH` に置いた node のスクリプトで、`compare` には `FAKE_COMPARE_STATUS` を返し、チェックの名前ごとに n 回目の呼び出しで `FAKE_CHECK_RUNS` の n 周目を返す。回数は `FAKE_STATE_DIR` の下のファイルで数える
