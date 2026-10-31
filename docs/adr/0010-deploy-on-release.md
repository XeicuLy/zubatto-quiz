# 本番のデプロイは Release をきっかけに動かし、タグのコミットを1回の承認で出す

## Status

accepted

## Context

ADR 0005 では、本番のデプロイは手で動かしたとき（`workflow_dispatch`）だけ行うと決めた。マージしただけで API の Worker が出て、本番の最中に部屋の接続を切る（ADR 0006）のを避けるためだった。その後 ADR 0009 で、production の Environment に Required reviewers を付けた。今は、workflow が自動で動き始めても、承認しなければ本番には何も出ない。ADR 0005 が手で動かすことにした理由は、承認が受け持つようになった。

2026-10-28 に v1.0.0 を出したときは、リリース PR をマージしたあと、main の CI が終わるのを待ち、deploy.yaml を動かし、3回承認した。deploy.yaml は main の先頭を出すので、そのあいだに #167 が入り、本番は `v1.0.0-1-g3caafe1` になって、版とずれた。

制約は次のとおり。GitHub の振る舞いは、2026-10-28 時点の公式ドキュメントと、v1.0.0 の Release で確かめた。

- main のルールセットは PR 必須で、`bypass_actors` が空。production にデプロイしてよいのは、今は `main` ブランチだけ
- 承認は、production を使う job ごとに求められる。`all` では3回になる（ADR 0009）
- 本番の最中は API の Worker をデプロイしない（ADR 0006）
- GITHUB_TOKEN が起こしたイベントは workflow run を作らないが、GitHub App の installation token なら作る。release-please は App の token で Release を作る。v1.0.0 の Release は `zubakui-release[bot]` が作り、draft ではなく、`target_commitish` はコミットの SHA だった
- `release` イベントの `published` は、draft ではない Release ができたときと、draft を公開したときに動く。pre-release でも動く。run の `GITHUB_SHA` はタグのコミット、`GITHUB_REF` は `refs/tags/<タグ名>` で、workflow のファイルもそのコミットのものが使われる
- Environment の「デプロイしてよいブランチとタグ」は、run の `GITHUB_REF` と照らし合わされる。deployment branch policy の API は `type: tag` を取り、名前は fnmatch で書く（`*` は `/` をまたがない）
- リポジトリの ruleset は `target: tag` でタグを対象にでき、`creation`・`update`・`deletion` のルールを持てる。`bypass_actors` には `actor_type: Integration` で GitHub App を入れられる
- `workflow_dispatch` は、ブランチだけでなくタグの上でも動かせる
- リリース PR をマージすると、release-please の workflow と main の CI が同時に動く。Release の run は、タグのコミットの CI がまだ走っている間に始まる

この ADR は、ADR 0005 の「手で動かしたときだけデプロイする」と、ADR 0009 の「v\* タグの ruleset は入れない」「承認は production を使う job ごとに3回」を置き換える。

## Decision Drivers

- DD1 本番の最中の安全: 本番の最中に API の Worker を出さない（ADR 0006）。自動で動き始めても、人が承認しなければ本番には何も出ない
- DD2 正確さ: 本番の版が、Release のタグとちょうど一致する
- DD3 権限と守り: 本番への入口（main への PR と `v*` のタグ）を、App と人の承認に絞る。Cloudflare のトークンの守りは、トークンのそば（production の Environment）に置く（ADR 0009）
- DD4 運用の手間: リリース PR をマージしてから本番に出るまで、1人で少ない手で回せる
- DD5 既存の決定を崩さない: main のルールセットを緩めない。`workflow_dispatch`（`web` だけ出すなど）を残す
- DD6 ロックイン耐性: デプロイの決まりは Actions の側に置き、release-please に持たせない（ADR 0009 の DD6）

## Considered Options

きっかけ

- U1. `release: published` で deploy.yaml を動かす
- U2. release-please の workflow（main への push）の中で、出力の `release_created` を見てデプロイを呼ぶ
- U3. 今のまま手で動かす

出すコミット

- G1. タグのコミット（`release` の run の `GITHUB_SHA`）
- G2. main の先頭

タグの守り

- H1. `v*` のタグを release-please の App だけが作り、動かし、消せる ruleset を入れる
- H2. 入れない（ADR 0009 のまま）

Release で動くときの target

- N1. いつも `all`
- N2. 前のタグとの差（`apps/api` や migrations が変わったか）で決める

承認の回数

- E1. job ごと（`all` で3回）のまま
- E2. 承認だけの job を先頭に置いて1回にし、production から reviewers を外す
- E3. production を使う job を1つにまとめ（マイグレーション → API → 画面を1つの job で行う）、reviewers を production に残したまま1回にする

タグのコミットの CI がまだ走っているとき

- Q1. `verify-ci` が、CI が終わるまで待つ（待つ時間に上限を置く）
- Q2. 今のまま止まり、CI が終わってから手で動かし直す

## Decision Outcome

採用する選択肢: 「U1（`release: published` で動かす）」。あわせて G1・H1・N1・E3・Q1 を選ぶ。`workflow_dispatch` は残す。

理由:

- U1 は DD4 を満たし、DD1 も崩さない。リリース PR をマージすれば、タグと Release ができ、デプロイが動き出して承認を待つ。本番に出るのは承認したときだけ
  - U2 は DD6 を満たさない。デプロイが release-please の出力に結びつき、ツールを替えるとデプロイの仕組みも作り直しになる。U1 は GitHub の Release に反応するだけなので、Release を作るツールが何であっても動く
  - U3 は DD2 と DD4 を満たさない。v1.0.0 と同じずれと手間が残る
- G1 は DD2 を満たす。`release` の run は何も指定しなくてもタグのコミットを checkout するので、本番の版が `vX.Y.Z` ちょうどになる。G2 では、リリースのあとに入った PR も一緒に出てしまう
- H1 は DD3 を満たす。U1 では、production に `v*` のタグからのデプロイを許す。すると、タグを打つことと、タグの上で `workflow_dispatch` を動かすことが、本番への入口になる。タグを作れるのを App だけにすれば、入口は「main への PR → リリース PR のマージ」から変わらない
  - ADR 0009 で入れなかった理由は、打ち間違えたタグを消すたびに ruleset を外す手間だった。タグを打つのは release-please だけなので、この手間はまれ。入口が増えるほうが重い
- N1 は DD4 を満たす。差を判定するコード（protocol は API と画面の両方に効く、マイグレーションもある）を作って保たずに済む。画面だけの変更でも API を出し直すが、本番の外なら困らない。本番の最中は承認しないことで DD1 を守る。ADR 0009 の「画面だけのデプロイを止める仕組みは作らない」（#160）とも合う
- E3 は DD3 と DD4 を両方満たす
  - ADR 0009 が3回の承認を受け入れたのは、「`all` は本番の外でたまに出すだけ」だったから。Release のたびに `all` で動くと、3回押すのは毎回になる
  - E2 は DD3 を満たさない。ADR 0009 に書いた理由のとおり、production から reviewers を外すと、main の別の workflow が production を使えば、承認なしでトークンを読める
  - E3 は job の分け方を変えるだけで、reviewers は production に残る。承認の単位が job なので、job を1つにすれば承認も1回になる
- Q1 は DD4 を満たす。Release の run はマージの直後に始まるので、タグのコミットの CI はほぼ必ず走っている。Q2 では毎回手で動かし直すことになり、U1 の良さが消える。待つのは `verify-ci` で、Environment もトークンも使わないので、待っている間にトークンを読める job はない

## Consequences

- 良い影響: リリース PR をマージして、1回承認すれば本番に出る。CI を待って deploy.yaml を動かす手がなくなる
- 良い影響: 本番の版が Release のタグと一致する。deploy.md の手順 0 で、`-<数>-g<SHA>` が付かない
- 良い影響: production を使う job が1つになり、Deployment が run ごとに1つになる。承認を拒むと何も出ないので、「マイグレーションと API だけが新しい」という途中の状態が、拒んだことでは起きなくなる
- 良い影響: production に `v*` のタグを許すので、前の版に戻すときは、そのタグの上で `workflow_dispatch` を動かせる。使われる deploy.yaml は、そのタグのコミットのもの
- 悪い影響: リリース PR のマージが、本番へのデプロイの始まりになる。本番の最中は、リリース PR をマージしない。マージしてしまったら、Release の run の承認を押さず、**Reject** する。本番のあとに出すときは、その run の **Re-run all jobs** で動かし直して承認する
- 悪い影響: 承認を待っている Release の run も、deploy.yaml の concurrency の1つに数えられる（#172 で、2026-10-31 に確かめた）。そのため本番の最中に `web` を出すときは、先に Release の run を Reject する
- 悪い影響: job を1つにまとめるので、**Re-run failed jobs** で画面の Worker だけを動かし直すことはできない。動かし直すと、マイグレーション（当て済みなら飛ばされる）と API も、もう一度行われる。本番の外なら困らない。画面だけを出し直すときは `web` で動かす
- 悪い影響: `v*` のタグを打ち間違えたときは、タグの ruleset を一時的に外さないと消せない
- 悪い影響: Release で動くときは、画面だけの変更でも API の Worker を出し直す
- 対応事項（#170）: `v*` のタグの ruleset を入れ、bypass は release-please の App だけにする（`actor_type: Integration`）。production の deployment branch policy に `v*`（`type: tag`）を足す。ほかのブランチやタグからは出せないまま。ruleset の JSON を `docs/runbooks/` に置き、release.md と deploy.md の手順を直す
- 対応事項（#171）: deploy.yaml を `release: published` でも動かす
  - Release で動くときの target は `all`
  - production を使う job を1つにまとめ、`web` ではマイグレーションと API の step を飛ばす
  - `verify-ci` は、タグのコミットが main にあることを確かめ、必須のチェックが終わるまで待つ（上限を置く）
  - `tools/docs-check` の `deploy-workflow.test.ts` を作り直す
  - deploy.md（承認は1回、手順 0 の読み方、本番の最中の扱い）と release.md を直す
  - release-please の PR の見出し（`pull-request-header`）と、release-please.yaml のコメントの「デプロイはしない」を直す
- 対応事項（#172）: Release からの最初の自動デプロイを試し、次を確かめる（2026-10-31 に v1.1.0 で、すべて確かめた）
  - App の token で作った Release で deploy.yaml が動くこと
  - タグの ruleset が App のタグ作成を通すこと
  - production がタグの run を通すこと
  - 承認が1回で済むこと
  - 承認を待っている run が concurrency を占めるか
- 対応事項: ADR 0005 と ADR 0009 の、置き換わった決定のところに、この ADR を指す一言を足す（Status は accepted のまま。置き換わるのは一部だけ）。CLAUDE.md の ADR の範囲と、デプロイの説明を直す
