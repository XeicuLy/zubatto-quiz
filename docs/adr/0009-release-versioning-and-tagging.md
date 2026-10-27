# リリースの番号と CHANGELOG は release-please のリリース PR で決め、本番には承認してからデプロイする

## Status

accepted

## Context

本番は 2026-10-18 から動いているが、タグも GitHub Release も CHANGELOG もない。そのため「いま本番にあるのはどのコミットか」「前に出してから何が変わったか」に答えにくい。コミットは commitlint で Conventional Commits になっているので、それを材料に番号とリリースノートを作れる。

仕組みを選ぶうえでの制約は次のとおり。GitHub と各ツールの振る舞いは、2026-10-27 時点の公式ドキュメントと、changelogen 0.6.2・release-please 17.11.2 のソースで確かめた。

- main のルールセットは PR 必須で、`bypass_actors` が空。workflow から main へ push できない
- GITHUB_TOKEN が起こしたイベントは、新しい workflow run を作らない。例外の `pull_request`（opened・synchronize・reopened）も、run は承認待ちになり、書き込み権限のある人が「Approve workflows to run」を押すまで動かない。GitHub App の token や PAT で作った PR なら、承認なしで動く
- GITHUB_TOKEN で PR を作るには、リポジトリの「Allow GitHub Actions to create and approve pull requests」を有効にする必要がある。この設定は、PR を作ることと承認することをひとまとめに許す。このリポジトリでは無効
- ADR 0005 で、本番のデプロイは `workflow_dispatch` で手で動かすと決めた。main にマージしてもデプロイしない。本番中に API の Worker を出さないため（ADR 0006）
- Release API でまだないタグを指定すると、`target_commitish`（既定は既定のブランチ）の先頭にタグが作られる
- `environment:` を書いた job は、動くたびに GitHub の Deployment を記録する。deploy.yaml でも、production の Deployment が SHA つきで残っている
- このリポジトリは public なので、Environment の Required reviewers を無料のプランで使える（private では Team 以上が要る）

この ADR は、検討の途中で方向を変えた。はじめは「タグはデプロイが成功したコミットに打つ」形（下の R4）を選んでいたが、仕事の現場の運用（版とデプロイを分けて記録する）を取り入れたいという考えから、R1 に変えた。

## Decision Drivers

- DD1 正確さ: 本番にあるコミットと、そこに入っている変更を、あとから正しく答えられる。まだ本番に出ていない変更を「本番に出た」と記録しない
- DD2 既存の決定を崩さない: main のルールセット（PR 必須、bypass なし）を緩めない。ADR 0005 の「デプロイは手で動かし、マージではデプロイしない」を変えない
- DD3 権限: 書き込みの権限は、使う job と場面に閉じる。新しい secret を置くなら、main の workflow でしか読めない場所に置く
- DD4 運用の手間: 1人で回せる。手元の状態（pull や fetch のし忘れ）で結果が変わらない
- DD5 変更容易性: Go への書き直し（ADR 0001）で Worker の構成が変わっても、仕組みがそのまま残る
- DD6 ロックイン耐性: ツールに任せるのは、番号・CHANGELOG・タグ・Release の作成までにする。デプロイの決まりはツールに持たせない
- DD7 学びの価値: 仕事の現場で使われている道具とやり方（リリース PR の bot、GitHub App、Environment の承認）に慣れる

## Considered Options

全体の仕組み

- R1. release-please + GitHub App。bot がリリース PR を開いて更新し続け、マージでタグと Release を作る。本番に何があるかは Deployments で答え、本番に出す前に Required reviewers で承認する
- R2. リリース PR のマージでデプロイする
- R3. workflow で `changelogen --release --push` を実行する
- R4. 手元の `changelogen --bump` でリリース PR を作り、手で動かしたデプロイが成功したら、そのコミット（`github.sha`）にタグと Release を作る
- R5. R4 のリリース PR の準備を workflow に任せる。workflow は `release/vX.Y.Z` ブランチに push し、PR は run のまとめのリンクから自分で開く
- R6. R5 の PR の作成まで workflow に任せる（GITHUB_TOKEN で PR を作る）

R1 の中で決めること

- マージの方法: W1 squash マージだけにする / W2 マージコミットのまま、本文に PR の題名を入れない / W3 PR の本文の `BEGIN_COMMIT_OVERRIDE` で、出す行を PR ごとに書く
- 番号の単位: V1 リポジトリ全体で1つ / V2 パッケージごと
- これまでの履歴: `bootstrap-sha` で読まず、v1.0.0 の節を手で書く / すべて読ませて手で直す
- v\* タグの ruleset: 入れる / 入れない

## Decision Outcome

採用する選択肢: 「R1（release-please + GitHub App。本番に何があるかは Deployments で答え、本番に出す前に Required reviewers で承認する）」。あわせて W1・V1・bootstrap を選び、v\* タグの ruleset は入れない。

理由:

- R1 は、版（タグと Release）と本番（Deployments）を別々に記録する。DD1 を満たすのに、タグに「本番に出た」という意味を持たせなくてよい
  - タグは「この版ができた」印で、リリース PR のマージで付く。本番にどのコミットがあるかは、production の Deployments（いつ、どの SHA を、どの run が出したか）が答える。本番の SHA がタグより新しければ、本番にはまだ版になっていない変更がある、と読める
  - R4 はタグ1つに「版」と「本番に出た」の2つの意味を持たせていた。そのため、画面だけのデプロイで本番にない API の変更がタグに載らないよう止める仕組みと、番号がすでに別のコミットのタグになっているときにタグを飛ばす分岐が要り、どちらも「タグは release の job だけが打つ」という前提に頼っていた。R1 ではどちらも要らない
- R1 は DD2 を満たす。bot のリリース PR はふつうの PR としてルールセットを通り、App の token で作るので ci / e2e は承認なしで動く。マージしてもデプロイはしない（ADR 0005 のまま）。本番に出す前の承認は、ADR 0005 の「手で動かす」に足す守りで、置き換えではない
- R1 は DD7 を最も満たす。release-please・GitHub App の token・Environment の承認は、仕事の現場でよく使われている組み合わせ
- R2 は DD2 を満たさない。本番中にリリース PR をマージすると、API の Worker が出てしまう
- R3 は DD2 を満たさない。main への push はルールセットに拒まれる。動かすには bypass か PAT が要る
- R4 は DD1〜DD3 を満たすが、DD4（手元の状態に左右される）と DD7 で R1 に劣る。また、上に書いた2つの仕組みが要る
- R5 は R4 の DD4 を直すが、DD7 と、タグに2つの意味がある点は R4 と同じ
- R6 は DD3 を満たさない。「Allow GitHub Actions to create and approve pull requests」を有効にすると、workflow が PR を承認できるようになる。いまは承認0件でマージできるので害はないが、承認を必須にしたときの抜け道になる。手の数も R5 と変わらない（PR を作る代わりに、承認待ちの CI を動かすボタンを押す）
- W1（squash マージだけ）: 2026-10-27 に release-please 17.11.2 の dry-run を main に向けて実行したところ、すべての変更が2行ずつ出た。GitHub のマージコミットは本文に PR の題名を入れ、release-please は本文に `feat: ` で始まる段落があると別の変更として切り出す（`splitMessages`）ため、PR の題名と PR の中のコミットの両方が数えられる。W1 なら PR 1つが CHANGELOG の1行になり、release-please と多くのチームの前提にも合う
  - W2 はコミット1つが1行になり、レビューで足した修正のコミットも1行ずつ出る。dry-run では、1つの PR（#154）の修正が3行になった
  - W3 は PR ごとに書く手間がかかる（DD4）
  - W1 では、PR の中で分けたコミット（コードと docs）は main の履歴に残らない。PR の画面には残る
- V1（リポジトリ全体で1つ）: npm に出すパッケージはなく、デプロイの単位（web と api の Worker）とパッケージ（protocol など）も一致しない。V2 はタグと Release が倍になり、どれを本番に出したかも分かりにくくなる（DD4）
- bootstrap: これまでのコミットは、マージコミットの本文に PR の題名が入った形で残っているので、読ませると二重の行が約110行出る。release-please は main が進むたびにリリース PR を書き直すので、手で直すならマージの直前にしかできない（DD4）
- v\* タグの ruleset は入れない: タグを作るのは release-please だけで、打ち間違えたタグを消すたびに ruleset を無効にする手間がかかる。必要になったら足す

## Consequences

- 良い影響: 版（タグ・Release・CHANGELOG）は release-please が作り、本番にあるものは Deployments が記録する。どちらも自分でコードを書かずに済む
- 良い影響: 番号と CHANGELOG を手元で作らないので、pull や fetch のし忘れで結果が変わらない
- 良い影響: 本番に出す前に承認の一手が入る。workflow を動かしただけでは本番に出ない
- 悪い影響: GitHub App とその秘密鍵を管理する。鍵が漏れると、App に許した範囲（このリポジトリの contents・pull requests・issues の書き込み）で書き換えられる
- 悪い影響: main の履歴は PR 1つにつき1コミットになり、PR の中のコミットの分け方は残らない
- 悪い影響: PR の題名が main のコミット名になる。題名が Conventional Commits の形でないと CHANGELOG に出ないので、PR の題名を CI で確かめる必要がある
- 悪い影響: タグは「本番に出た」印ではない。本番に何があるかは production の Deployments と deploy.yaml の run で見る。Deployment は production を使う job ごとに作られ、job が失敗しても残るので、Worker ごとの版は、`deploy-api`・`deploy-web` が成功したいちばん新しい run の SHA から読む（deploy.md の「デプロイのあとに確かめる」）
- 悪い影響: 承認は production を使う job ごとに求められる。`all` では migrate・deploy-api・deploy-web の前に1回ずつ、3回押す（2026-10-27 に `all` を動かして確かめた。ドキュメントには書かれていない）。承認だけの job を先頭に置いて1回にまとめる形は採らない。そうするには production から reviewers を外すことになり、main の別の workflow が production を使えば、承認なしで Cloudflare のトークンを読める。守りはトークンのそばに置く。`all` は本番の外でたまに出すだけなので、手間はまれ
- 対応事項（#158）: release-please を入れる
  - GitHub App を作り、このリポジトリにだけ入れる。権限は Contents・Pull requests・Issues の Read and write（リリース PR に付ける `autorelease: pending` のラベルに Issues が要る）。App の ID と秘密鍵は main だけに絞った Environment の secret に置き、token は `actions/create-github-app-token` で作る
  - `release-please-config.json` と `.release-please-manifest.json` をルートに置く。`release-type: node`、`include-component-in-tag: false`（指定しないとタグが `zubatto-quiz-v1.0.0` になる）、`pull-request-title-pattern: "chore: v${version} をリリースする"`、`changelog-sections` で feat を「新機能」、fix を「修正」、perf を「性能」にし、ほかは `hidden`、`bootstrap-sha`
  - workflow は main への push で動かす
  - runbook に App の作り方と、鍵の置き場所・入れ替え方を書く
- 対応事項（#158）: squash マージだけにする。main のルールセットの `allowed_merge_methods` を `["squash"]` にし、リポジトリの squash の設定を「題名は PR の題名、本文は空」にする。BREAKING は PR の題名の `!` で表す。PR の題名を commitlint で確かめる job を足し、必須のチェックにする。`docs/runbooks/main-ruleset.json` と CONTRIBUTING も直す
- 対応事項（#159）: production の Environment に Required reviewers（自分）を付ける。「Prevent self-review」は有効にしない（1人では承認できなくなる）。管理者が決まりを飛ばせる設定（`can_admins_bypass`）は無効にする。deploy.md の手順に承認を足す
- 対応事項（#160）: 画面だけのデプロイを止める仕組みは作らない。Issue は閉じる
- 対応事項（#161）: 最初のリリース PR に v1.0.0 の節（最初のリリースとして機能の要約）を手で書き、マージして v1.0.0 のタグと Release を確かめる
- 対応事項: CLAUDE.md の ADR の範囲（`0001`–`0005`）と、コミットの決まり（PR の題名）を直す
- 対応事項: CODEOWNERS は入れない。GitHub では PR を作った本人がその PR を承認できず、ルールセットに bypass がないので、自分だけをコードオーナーにして承認を必須にすると、自分の PR がマージできなくなる。人が増えたときに改めて決める
