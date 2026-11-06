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
- `concurrency` は GitHub の既定のまま（待てる run は1つ）。新しい run が来ると、待っている run は取り消される。取り消された `all` や Release の run は、runbook の手順で動かし直す。承認を待っている Release の run も、動いている1つに数えられる（#172 で、2026-10-31 に確かめた）。`queue: max` は足さない。並んだ順に動く保証がなく、古いコミットが最後に出ることがある
- step はルートの `db:migrate:remote`・`deploy:api`・`deploy:web` を呼ぶ。API のものは `--env=""` を付ける。画面の `deploy` は `vite build && wrangler deploy` で、E2E のビルドが残した設定を使わない（[testing.md の「本番と同じビルドで動かす」](testing.md#本番と同じビルドで動かす)）

## verify-ci

- `verify-ci` の job は `permissions: contents: read, checks: read` で、Environment もシークレットも使わない。`.github/scripts/verify-required-checks.sh` と `main-ruleset.json` だけを sparse checkout する
- スクリプトは、はじめにコミットが main にあるかを `gh api repos/…/compare/main...$GITHUB_SHA --jq .status` で確かめる。`identical` か `behind` なら通り、`ahead` か `diverged` なら止まる。こうすると、履歴を全部チェックアウトしなくて済む
- 次に、ルールセットの必須のチェック（`ci`・`e2e`・`pr-title`）を、`CI_POLL_SECONDS`（30）秒ごとに、すべてが `completed`/`success` になるまで見る。チェックは、その `integration_id` を `app_id` にして絞り、`GITHUB_SHA` の上のいちばん新しい check run を読む。名前はルールセットから読み、workflow には写さない
- 終わって成功でないものがあれば、すぐに止まる。まだ終わっていないもの（`queued`・`in_progress`・`waiting`・`requested`・`pending`）と、まだ見つからないもの（`not_found`）と、`gh api` の読み出しの失敗（`api_error`）は、`CI_WAIT_SECONDS`（1800）まで待つ。Release の run は、マージで動いた main の CI が走っている間に始まるため（ADR 0010 の Q1）
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
- minor と patch は1つの PR にまとめる。PR ごとに `e2e` が約10分かかるので、数を減らす。major は action ごとの PR に分ける。`release-please.yaml` と `deploy.yaml` は PR の CI で動かないので、壊れる更新はマージのあとで初めて分かる。分けておけば、原因の action をすぐ切り分けられる
- `cooldown.default-days` は3日にする。乗っ取られて新しいタグが公開されると、そのタグは `--verify` を通る。`--verify` が止めるのは、すでにあるタグが動いたときだけだからだ。公開から数日待って、見つかるまでの時間を稼ぐ。github-actions では `semver-major-days` などの版ごとの設定は使えない
- 更新の PR の GitHub Actions は `GITHUB_TOKEN` が読み取りだけになり、読める secrets は Dependabot secrets だけになる（今は0件）。本番の secrets は `production` 環境にあるので、更新された action のコードが PR の CI で動いても届かない。`pull_request_target` と `workflow_run` は使わない

更新の PR で読むことは次のとおり。

1. `actions.lock` の差分で、`ref` と `commit` が更新した action の分だけ変わっていること。`owner_id` と `repo_id` が変わっていたら、リポジトリの持ち主が変わった可能性があるので、そのままマージしない
2. `release-please.yaml` か `deploy.yaml` が使う action なら、上流のリリースノートを読む。必須チェックが通っても、この2つの中での動きは確かめられていない
3. `ci` の `Verify actions.lock` が `tag-commit-mismatch` か `unreachable-pin` で落ちたら、[上の手順](#ci-で落ちたとき)で理由を確かめる
4. PR の題名を、日本語の subject に直してからマージする（例: `ci: mise-action と upload-artifact を更新する`）。`commit-message.prefix` で決められるのは `ci` までで、subject は英語のまま届く。`pr-title` の commitlint は subject の言語を見ないので、直さなくても通り、そのまま `main` のコミットになる

### npm の依存の更新

- `directory` は `/` だけにする。`pnpm-lock.yaml` は root に1つだけで、pnpm は `.mise.toml` と同じ 12 系まで Dependabot が対応している（[GitHub の文書](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories)で、2026-11-07 に確かめた）
- `commit-message.prefix` は `chore` にし、`include: scope` は書かない。理由は action の `ci` と同じ。`chore` は版を上げないので、更新は次のリリースで本番に届く。脆弱性を直す更新をすぐ本番に出したいときは、PR の題名を `fix:` に書き換えてからマージする
- minor と patch は `minor-and-patch` の1つの PR にまとめ、ほかの major はパッケージごとの PR にする。`storybook`・`react`・`tailwindcss`・`commitlint` は版をそろえて動くので、major のときだけ一緒に別の PR にする。minor と patch まで分けないのは、グループの数だけ PR と `e2e` が増えるからだ。グループは先に一致したものに入るので、`minor-and-patch` を最後に書く
- `cooldown` は `default-days` を3日、`semver-major-days` を7日にする。公開直後の版を避け、[pnpm の公開待ち期間](#pnpm-の公開待ち期間)に引っかからないようにする
- `@babel/core` と `@types/node` の major は `ignore` で止め、手で上げる。`@babel/core` は 8 系にすると React Compiler が既定値付き props の部品を黙って飛ばす（[frontend.md の「全体の形」](frontend.md#全体の形)）。`@types/node` は `.mise.toml` の Node の版に合わせる
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
3. major の PR なら、上流のリリースノートを読む。`react` や `tailwindcss` は、テストが通っても見た目が変わることがある
4. npm の最初の PR では、`pnpm-lock.yaml` の `importers` の差分で、root だけでなく `apps/*`・`packages/*`・`tools/*` の依存も更新されていることを確かめる。`dependabot.yml` は `main` に入るまで動かないので、マージの前には確かめられない

## ログ

本番中と本番のあとのログの見方と残し方は、[logs.md](../runbooks/logs.md) にある。ここには、手順に出てこない作りの理由を書く。

- `logs:api`・`logs:web` は `wrangler tail --env="" --format json` を動かす。外側の `pnpm -s` とスクリプトの中の `pnpm --silent` の両方で、pnpm 自身の出力をファイルに入れない。ファイルへは `>>` で書く。`>` は同じ名前のファイルを空にするので、tail を動かし直したときに前のログが消える
- `wrangler tail` と `wrangler delete` は `wrangler.jsonc` を読み、E2E のビルドが残す `.wrangler/deploy` の転送は読まない（転送を読むのは `deploy`・`versions`・`triggers deploy`・`preview` だけ）。E2E のビルドのあとでも、本番の Worker の tail を取れる
- tail でも Workers Logs でも、`cookie` は `REDACTED` になり、クエリは `redact_query_string` で消える。`cf-connecting-ip`・`x-real-ip`・`cf-ipcountry` は残り、それだけを消す設定はない。ADR 0005 はこれを受け入れた（#98、[logs.md の「ログに残るもの・残らないもの」](../runbooks/logs.md#ログに残るもの残らないもの)）
- `invocation_logs` は有効のままにする。止めると、残るのは 500 と例外だけになる（ADR 0005）
- アプリは自分の `console.*` を持たない。Hono の既定の `onError` が、500 のときに `console.error` を出す。WebSocket の `canceled` で `exceptions` が空のものは、端末の側から切れただけで、エラーではない

## 文書と workflow のテスト

`tools/docs-check`（vitest の project `docs`）は、文書・設定・workflow が、リポジトリの今の形とずれていないかを確かめる。

| テスト                           | 確かめること                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `links.test.ts`                  | `test/documents.ts` に並べた文書の相対リンクと `#見出し` が、リポジトリの中を指し、GitHub の見出しの slug で解決できること                                                                                                                                                                           |
| `scripts.test.ts`                | 同じ文書の `pnpm [-s] [--filter <pkg>] run <script>` が、あるスクリプトを指すこと。`logs:api`・`logs:web` が `pnpm --silent` で始まり、ファイルへ `>>` で残すこと                                                                                                                                    |
| `docs-index.test.ts`             | `docs/README.md` の ADR の一覧に、どの ADR もちょうど1行あり、状態が ADR の Status と合うこと                                                                                                                                                                                                        |
| `main-ruleset.test.ts`           | [上の「ルールセット」](#ルールセット)のとおり                                                                                                                                                                                                                                                        |
| `release-tag-ruleset.test.ts`    | 同じく                                                                                                                                                                                                                                                                                               |
| `release-please.test.ts`         | [上の「リリース」](#リリース)のとおり                                                                                                                                                                                                                                                                |
| `dev-vars-example.test.ts`       | [上の「インフラの管理」](#インフラの管理)のとおり                                                                                                                                                                                                                                                    |
| `ci-workflow.test.ts`            | `run:` に `github.event.*` や `github.head_ref` を `${{ }}` で埋め込んでいないこと。そうした値は `env:` を通す。`ci` が `pnpm install` より前に `--verify` を動かし、トークンをその step にだけ渡すこと。`--verify` が止めない `uses:` の書き方がないこと（[上の「action の固定」](#action-の固定)） |
| `dependabot.test.ts`             | [上の「Dependabot での更新」](#dependabot-での更新)のとおり（週に1回、題名は scope のない `ci:`・`chore:`、major を分ける、グループの順番、`cooldown` の下限、手で上げる major、公開待ち期間を弱める設定がないこと、自動マージがないこと）                                                           |
| `deploy-workflow.test.ts`        | deploy.yaml と ci.yaml を `yaml` で読み、きっかけ（`release` か、`target` を付けた dispatch）と失敗する job やスクリプトごとに、どのスクリプトが動くかを試す（`scriptsThatRun`）。`production` を使う job が1つだけであること                                                                        |
| `verify-required-checks.test.ts` | `verify-required-checks.sh` を偽の `gh` と本物の `jq` で、`CI_POLL_SECONDS=0` で動かす                                                                                                                                                                                                               |
| `oxlint-layers.test.ts`          | 一時フォルダーに `.oxlintrc.json` の写しと、import を1行だけ書いたファイルを置いて oxlint を走らせ、`apps/web/src` の層の柵と `import/no-cycle` が効くこと（[frontend.md の「全体の形」](frontend.md#全体の形)）                                                                                     |

- `scriptRunsIn` は、スクリプト名を空白かバッククォートの手前まで読む。そのため `logs:web.bak` を `logs:web` とは読まないが、名前のすぐあとの全角の `）` は名前の一部として読む。コマンドは1行に1つずつ書く
- 文書の一覧は `test/documents.ts` にあり、`links.test.ts` と `scripts.test.ts` が共有する。相対リンクや `pnpm run` のコマンドを書く文書を足したら、ここにも足す
- `deploy-workflow.test.ts` の `targetOf` は上の `env.TARGET` の式だけを、`evaluateIf` は `env.TARGET == '…'` だけを知っている。どちらも、知らない形を見ると例外を投げる。job の条件を変えたら、この2つも広げる
- 偽の `gh` は `PATH` に置いた node のスクリプトで、`compare` には `FAKE_COMPARE_STATUS` を返し、チェックの名前ごとに n 回目の呼び出しで `FAKE_CHECK_RUNS` の n 周目を返す。回数は `FAKE_STATE_DIR` の下のファイルで数える
