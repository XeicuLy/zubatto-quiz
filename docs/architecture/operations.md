# 運用の仕組み

インフラの設定、GitHub のルールセット、リリース、本番へのデプロイ、ログと、それらを確かめる `tools/docs-check` のテストが、なぜその形になっているかをまとめる。決めた理由の大もとは [ADR 0005](../adr/0005-infrastructure-management.md)・[ADR 0009](../adr/0009-release-versioning-and-tagging.md)・[ADR 0010](../adr/0010-deploy-on-release.md) にある。手を動かす手順は [README の「運用の手順書」](../../README.md#運用の手順書)から開く runbook にあり、ここには書かない。

コードを書くときに守る約束は、[CLAUDE.md](../../CLAUDE.md) に1行ずつ残している。この文書はその説明で、見出しを変えるときは CLAUDE.md のリンクも直す（docs-check が確かめる）。

## インフラの管理

- インフラの設定は `wrangler.jsonc` だけで書く（ADR 0005）。Worker、DO の `new_sqlite_classes` のマイグレーション、D1 の binding がここにある。Terraform は、Go へ移すまで入れない
- 設定で表せないものは、`docs/runbooks/` の runbook に書く。GitHub の OAuth App（手元用と本番用）、シークレット、ホストの許可リスト、使用量の確かめ方と止め方、main と `v*` のタグのルールセット。シークレット・テーブル・コマンド・CI の job 名など、runbook に関わるものを変えたら、同じ変更で runbook も直す
- シークレットは `wrangler secret put` で入れる。`secrets.required` があると、シークレットのない Worker の最初のデプロイは止まる。そこで本番では、先に `secret put` で空の Worker を作ってからデプロイする。こうすると、デプロイの workflow はアプリのシークレットを持たずに済む。順番と理由は [secrets.md の「はじめて入れるとき」](../runbooks/secrets.md#はじめて入れるとき)にある。Worker を消すとシークレットも消えるが、D1 は残る
- `wrangler secret put`・`secret list` には `--env=""` を付けて、`wrangler.jsonc` の先頭の設定を選ぶ。付けないと、`env.e2e` があるので警告が出る（`d1 execute` は警告しない）。値をパイプで渡すと末尾の空白が削られるので、`BETTER_AUTH_SECRET` は `openssl rand -base64 32` からパイプで入れ、画面に出さない（[secrets.md の「本番: wrangler secret put」](../runbooks/secrets.md#本番-wrangler-secret-put)）
- `apps/api/.dev.vars.example` は、`secrets.required` の名前を値なしで並べたひな形（`BETTER_AUTH_URL` だけは手元の URL が入る）。`.gitignore` で戻している。名前が `wrangler.jsonc` とずれたり、シークレットに値が入ったりすると、`dev-vars-example.test.ts` が落ちる
- `host_allowlist.github_user_id` は TEXT の列。`'12345'` と文字列で書く。数で書くと `account.account_id` と合わない（[host-allowlist.md](../runbooks/host-allowlist.md)）
- 本番の D1 は `--update-config=false` を付けて作る。付けないと、`wrangler.jsonc` に足すかを聞かれ、既定が yes なので D1 の ID がリポジトリに入ってしまう（[README の「本番の環境を一から作る」](../../README.md#本番の環境を一から作る)）

## 本番の環境

- 本番は `https://zubakui-web.xeikit-app.workers.dev`。D1 は APAC の `zubakui`。2026-10-18 に README の手順で作った
- デプロイのあとの確かめ（state とセッションの Cookie、ホストの WebSocket の Cookie、CSP、通しの1回、tail と Observability）は、[deploy.md の「デプロイのあとに確かめる」](../runbooks/deploy.md#デプロイのあとに確かめる)にある
- それぞれの Worker がどのコミットで動いているかは、`Deploy API Worker`・`Deploy web Worker` の step が成功した、いちばん新しい deploy.yaml の run から読む（同じ節の 0）。`production` の Deployment の一覧からは読まない。Deployment は job ごとに作られ、その job が失敗しても残るため。Release の run はタグの上で動くので、`--branch` で絞らない。`web` の run では API の step が `skipped` になるので、step の結果で `web` と `all` の run を見分けられる

## ルールセット

手順と、それぞれの設定の理由は [branch-protection.md](../runbooks/branch-protection.md) にある。

- `docs/runbooks/main-ruleset.json` は、main のルールセットを `gh api -X POST .../rulesets --input` にそのまま渡せる形で書いたもの。`id`・`_links` など、GitHub が付ける項目は入れない
- `main-ruleset.test.ts` は、必須のチェックのどれもが `.github/workflows/` のどれかの job のチェック名（`jobs.<id>.name`、なければ job ID）と合うかを確かめる。テストはチェックの名前を決め打ちしない。その workflow が main への PR と push の両方で動くことも確かめる。デプロイの `verify-ci` が、main のコミットでチェックを探すため
- `docs/runbooks/release-tag-ruleset.json`（ルールセットの名前は `release-tags`）は、`refs/tags/v*` の `creation`・`update`・`deletion` を禁じ、bypass を release-please の App（`actor_type: Integration`、`bypass_mode: always`）1つだけにする。`update` には `parameters` を付けない。GitHub は `update_allows_fetch_and_merge` を受け付けたうえで捨てるので、書き出した設定と合わなくなる（2026-10-28 に確かめた）
- `actor_id` は App の設定画面の About に出る App ID（5496985）で、Client ID ではない。非公開の App は `gh api apps/<slug>` でも `performed_via_github_app` でも読めないので、`release-tag-ruleset.test.ts` は形だけを確かめ、値は確かめない
- タグのルールセットは、production に `v*` のタグを許すより前に作る。逆の順だと、その間は書き込みの権限があれば誰でも、好きなコミットにタグを打って本番に出せる。打ち間違えたタグは、ルールセットを一時的に止めないと消せない（[branch-protection.md の「打ち間違えたタグを消す」](../runbooks/branch-protection.md#打ち間違えたタグを消す)）

## リリース

手順は [release.md](../runbooks/release.md) にある。

- `release-please.yaml` は main への push のたびに、GitHub App の token で動く（`actions/create-github-app-token`）。`client-id` は `vars.RELEASE_APP_CLIENT_ID`、鍵は `secrets.RELEASE_APP_PRIVATE_KEY` で、どちらも main だけが使える Environment `release` に置く。workflow の `GITHUB_TOKEN` は `contents: read` のまま
- App の token を使うのは、`GITHUB_TOKEN` で作った PR では ci / e2e が承認待ちのまま動かず、`GITHUB_TOKEN` で作った Release では deploy.yaml が動き始めないため
- release-please はリリース PR（`chore: vX.Y.Z をリリースする`）を開いて更新し続ける。マージすると、そのコミットにタグ `vX.Y.Z` と GitHub Release を作る。release-please 自身はデプロイしない。タグは「この版ができた」印で、本番に出た印ではない。承認を断れば、タグはあっても本番は前のまま
- `release-please-config.json` は `include-component-in-tag: false`（付けないとタグが `zubatto-quiz-v1.0.0` になる）。`changelog-sections` は日本語で、commitlint のすべての type を並べる。`release-please.test.ts` が、`commitlint --print-config` の type と見比べる
- `bootstrap-sha` と `release-as: 1.0.0` は v1.0.0（2026-10-28、#161）のためだけのもので、もう消した。manifest に版があるのにどちらかが戻ると、テストが落ちる
- release-please は `CHANGELOG.md` と `.release-please-manifest.json` を丸ごと書き直す（manifest はいつも詰めた形、CHANGELOG は空行が3つ続く形）。そのため `.oxfmtrc.json` は両方を飛ばす
- ルートの `package.json` の `"version"` は `"name"` のすぐ下に置く。release-please は、ない項目を最後に足すので、`sortPackageJson` の並びが崩れる。ある項目はその場で書き換える。`release-please.test.ts` が両方を確かめる
- release-please-action v5.0.0 は release-please 17.6.0 を同梱している。手元で試す（dry-run）ときは、この版を使う
- 開いているリリース PR のファイルは、リリースノートが変わったときだけ作り直される。`ci:` や `docs:` だけのマージのあとで作り直したいときと、PR の本文の `BEGIN_COMMIT_OVERRIDE` の書き方は、[release.md の「CHANGELOG の行を直す」](../runbooks/release.md#changelog-の行を直す)と[「失敗したとき」](../runbooks/release.md#失敗したとき)にある
- マージを squash だけにしているのは、マージコミットだと release-please の `splitMessages` が本文の PR の題名も読み、どの変更も2回ずつ出るため（ADR 0009）

## デプロイの workflow

手順は [deploy.md](../runbooks/deploy.md) にある。

- 本番のデプロイは `.github/workflows/deploy.yaml` からだけ行う。`release: published`（target は `all`）か、手で動かす `workflow_dispatch`（`target` は `web` か `all`、既定は `web`）で動き始める（ADR 0010）
- workflow 全体の `env.TARGET` は `github.event_name == 'release' && 'all' || inputs.target`。`release` のイベントには `inputs` がない。イベントを明示して確かめるのは、手で動かしたときに `inputs.target` が空でも `all` にならないようにするため
- Release の run は、タグのコミット（`GITHUB_SHA`）をチェックアウトし、そのコミットの deploy.yaml で動く。前のタグの上で手で動かす（前の版に戻す）と、前の deploy.yaml で動く
- job は `verify-ci` → `deploy` の2つ。`environment: production` を使うのは `deploy` だけで、Cloudflare のトークンとアカウント ID もそこにしかない。`deploy` は、マイグレーション → API → 画面の順に step を行う。マイグレーションと API の step は `if: env.TARGET == 'all'` で、status の関数を書かない step の `if` は `success() && …` と同じなので、どれかの step が失敗するとその後ろは動かない
- `production` が許すのは、main ブランチと `v*` のタグだけ（`deployment-branch-policies`、`v*` は `type: tag`）
- `production` には Required reviewers（自分、`prevent_self_review: false`、`can_admins_bypass: false`）を付けている（ADR 0009）。承認は `production` を使う job ごとに求められる（2026-10-27 に、job を3つに分けていたころの `all` で確かめた。ドキュメントには書かれていない）。job を1つにしているので、承認は1回で済む（ADR 0010 の E3）。`deploy` を job に分け直さない。承認だけの job を先頭に置いて reviewers を外す形にもしない。トークンを持つ Environment から reviewers が外れてしまう
- Reject すると何も出ない。**Re-run failed jobs** は `deploy` の job をはじめからやり直す（当て済みのマイグレーションは飛ばされる）。画面だけを出し直すときは、`web` で新しく動かす。本番の最中にリリース PR をマージしてしまったら、その run を Reject し、本番のあとで **Re-run all jobs** する
- `timeout-minutes` は `deploy` が 30、`verify-ci` が 35。`verify-ci` は `CI_WAIT_SECONDS`（1800 秒）より長くしておく。短いと、どのチェックを待っていたかを書かずに時間切れで止まる。テストがこれを確かめる
- `concurrency` は GitHub の既定のまま（待てる run は1つ）。新しい run が来ると、待っている run は取り消される。取り消された `all` や Release の run は、runbook の手順で動かし直す。承認を待っている Release の run も、動いている1つに数えられる見込み（#172 で確かめる）。`queue: max` は足さない。並んだ順に動く保証がなく、古いコミットが最後に出ることがある
- step はルートの `db:migrate:remote`・`deploy:api`・`deploy:web` を呼ぶ。API のものは `--env=""` を付ける。画面の `deploy` は `vite build && wrangler deploy` で、E2E のビルドが残した設定を使わない（[testing.md の「本番と同じビルドで動かす」](testing.md#本番と同じビルドで動かす)）

## verify-ci

- `verify-ci` の job は `permissions: contents: read, checks: read` で、Environment もシークレットも使わない。`.github/scripts/verify-required-checks.sh` と `main-ruleset.json` だけを sparse checkout する
- スクリプトは、はじめにコミットが main にあるかを `gh api repos/…/compare/main...$GITHUB_SHA --jq .status` で確かめる。`identical` か `behind` なら通り、`ahead` か `diverged` なら止まる。こうすると、履歴を全部チェックアウトしなくて済む
- 次に、ルールセットの必須のチェック（`ci`・`e2e`・`pr-title`）を、`CI_POLL_SECONDS`（30）秒ごとに、すべてが `completed`/`success` になるまで見る。チェックは、その `integration_id` を `app_id` にして絞り、`GITHUB_SHA` の上のいちばん新しい check run を読む。名前はルールセットから読み、workflow には写さない
- 終わって成功でないものがあれば、すぐに止まる。`queued`・`in_progress`・`not_found` と、`gh api` の読み出しの失敗（`api_error`）は、`CI_WAIT_SECONDS`（1800）まで待つ。Release の run は、マージで動いた main の CI が走っている間に始まるため（ADR 0010 の Q1）
- `api_error` は `if ! result=$(…)` で捕まえる。こうしないと、GitHub の 5xx が1回あっただけで、`set -e` で待つのをやめてしまう。`CI_WAIT_SECONDS` と `CI_POLL_SECONDS` は step の `env` で渡し、スクリプトは `:?` で必須にしている
- PR の CI は `refs/pull/N/merge` の上で動くので、main に入ったコミットにはチェックが付かない。そのため `ci.yaml` は main への push でも動く
- シェルでは、全角の文字が続く変数を `{}` で囲む（`${result}）`）。bash は、マルチバイトの文字のバイトを変数名の一部として読むことがある

## ログ

本番中と本番のあとのログの見方と残し方は、[logs.md](../runbooks/logs.md) にある。ここには、手順に出てこない作りの理由を書く。

- `logs:api`・`logs:web` は `wrangler tail --env="" --format json` を動かす。外側の `pnpm -s` とスクリプトの中の `pnpm --silent` の両方で、pnpm 自身の出力をファイルに入れない。ファイルへは `>>` で書く。`>` は同じ名前のファイルを空にするので、tail を動かし直したときに前のログが消える
- `wrangler tail` と `wrangler delete` は `wrangler.jsonc` を読み、E2E のビルドが残す `.wrangler/deploy` の転送は読まない（転送を読むのは `deploy`・`versions`・`triggers deploy`・`preview` だけ）。E2E のビルドのあとでも、本番の Worker の tail を取れる
- tail でも Workers Logs でも、`cookie` は `REDACTED` になり、クエリは `redact_query_string` で消える。`cf-connecting-ip`・`x-real-ip`・`cf-ipcountry` は残り、それだけを消す設定はない。ADR 0005 はこれを受け入れた（#98、[logs.md の「ログに残るもの・残らないもの」](../runbooks/logs.md#ログに残るもの残らないもの)）
- `invocation_logs` は有効のままにする。止めると、残るのは 500 と例外だけになる（ADR 0005）
- アプリは自分の `console.*` を持たない。Hono の既定の `onError` が、500 のときに `console.error` を出す。WebSocket の `canceled` で `exceptions` が空のものは、端末の側から切れただけで、エラーではない

## 文書と workflow のテスト

`tools/docs-check`（vitest の project `docs`）は、文書・設定・workflow が、リポジトリの今の形とずれていないかを確かめる。

| テスト                           | 確かめること                                                                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `links.test.ts`                  | `test/documents.ts` に並べた文書の相対リンクと `#見出し` が、リポジトリの中を指し、GitHub の見出しの slug で解決できること                                                                                                    |
| `scripts.test.ts`                | 同じ文書の `pnpm [-s] [--filter <pkg>] run <script>` が、あるスクリプトを指すこと。`logs:api`・`logs:web` が `pnpm --silent` で始まり、ファイルへ `>>` で残すこと                                                             |
| `docs-index.test.ts`             | `docs/README.md` の ADR の一覧に、どの ADR もちょうど1行あり、状態が ADR の Status と合うこと                                                                                                                                 |
| `main-ruleset.test.ts`           | [上の「ルールセット」](#ルールセット)のとおり                                                                                                                                                                                 |
| `release-tag-ruleset.test.ts`    | 同じく                                                                                                                                                                                                                        |
| `release-please.test.ts`         | [上の「リリース」](#リリース)のとおり                                                                                                                                                                                         |
| `dev-vars-example.test.ts`       | [上の「インフラの管理」](#インフラの管理)のとおり                                                                                                                                                                             |
| `ci-workflow.test.ts`            | `run:` に `github.event.*` や `github.head_ref` を `${{ }}` で埋め込んでいないこと。そうした値は `env:` を通す                                                                                                                |
| `deploy-workflow.test.ts`        | deploy.yaml と ci.yaml を `yaml` で読み、きっかけ（`release` か、`target` を付けた dispatch）と失敗する job やスクリプトごとに、どのスクリプトが動くかを試す（`scriptsThatRun`）。`production` を使う job が1つだけであること |
| `verify-required-checks.test.ts` | `verify-required-checks.sh` を偽の `gh` と本物の `jq` で、`CI_POLL_SECONDS=0` で動かす                                                                                                                                        |

- `scriptRunsIn` は、スクリプト名を空白かバッククォートの手前まで読む。そのため `logs:web.bak` を `logs:web` とは読まないが、名前のすぐあとの全角の `）` は名前の一部として読む。コマンドは1行に1つずつ書く
- 文書の一覧は `test/documents.ts` にあり、`links.test.ts` と `scripts.test.ts` が共有する。相対リンクや `pnpm run` のコマンドを書く文書を足したら、ここにも足す
- `deploy-workflow.test.ts` の `targetOf` は上の `env.TARGET` の式だけを、`evaluateIf` は `env.TARGET == '…'` だけを知っている。どちらも、知らない形を見ると例外を投げる。job の条件を変えたら、この2つも広げる
- 偽の `gh` は `PATH` に置いた node のスクリプトで、`compare` には `FAKE_COMPARE_STATUS` を返し、チェックの名前ごとに n 回目の呼び出しで `FAKE_CHECK_RUNS` の n 周目を返す。回数は `FAKE_STATE_DIR` の下のファイルで数える
