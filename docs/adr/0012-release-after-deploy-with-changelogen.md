# 版はデプロイの dispatch で選び、デプロイが成功したコミットにタグと Release を作る

## Status

accepted

## Context

ADR 0009 で、版と CHANGELOG は release-please のリリース PR で決めることにし、ADR 0010 で、できた Release をきっかけにタグのコミットを本番に出すことにした。この流れで v1.0.0 から v1.3.0 まで出した。今の流れには、次の困りごとがある。

- タグと Release は、デプロイより先にできる。承認を Reject したり、デプロイが失敗したりしても、タグと Release は残る。「版はあるのに本番にない」状態が起きうる
- 版を決める場所（リリース PR のマージ）と、本番に出す場所（承認）が分かれている。dispatch のボタン1つで、版を選んで本番に出したい

ほかの事情は次のとおり。

- ADR 0009 の DD7（リリース PR の bot・GitHub App・Environment の承認に慣れる）は、v1.3.0 までの運用で果たした
- UnJS が好きで、その changelogen を使いたい。Vue や UnJS のリポジトリの、絵文字の見出しが並ぶ CHANGELOG にも憧れがある
- dispatch するのは、版を上げたいとき
- 本番の最中に直してデプロイする場面は想定しない。本番の最中は何もデプロイしない（ADR 0006 の「本番の最中は API の Worker を出さない」も、これで守る）

ADR 0009 は、デプロイが成功したコミットにタグを打つ案（R4・R5）を、次の理由で採らなかった。この ADR は、それに答える。

- タグに「版」と「本番に出た」の2つの意味が乗る。そのため、画面だけのデプロイで本番にない API の変更がタグに載らないよう止める仕組み（#160）と、番号がすでに別のコミットのタグになっているときにタグを飛ばす分岐が要る
- R4 は手元で `changelogen --bump` を動かすので、手元の状態（pull や fetch のし忘れ）に結果が左右される（ADR 0009 の DD4）
- DD7（学ぶ価値）で R1 に劣る

制約は次のとおり。changelogen は 0.6.2 のソースで、GitHub の設定は API で確かめた（どちらも 2026-11-13）。

- main のルールセットは PR 必須で、`bypass_actors` が空。workflow から main へ push できない
- `v*` のタグのルールセットの bypass は、release-please に使っている GitHub App（`zubakui-release`、`actor_type: Integration`）だけ。production は `main` と `v*` のタグから、`release` の Environment は `main` からだけ動かせる
- production を使う job は `deploy` の1つで、承認は1回（ADR 0010 の E3）。deploy.yaml の `concurrency` は run を1つずつ動かす
- changelogen の `bumpVersion` は、上げるものがないと patch に落ちる（`determineSemverChange(...) || "patch"`）。既定では docs・refactor・build なども patch に数える。基準の版は `package.json` の `version`
- `changelogen --release` は、リリース用の commit を作ってそこにタグを打つ。squash マージではその commit が main に入らないので、タグが main の外に取り残され、`verify-ci` がそのタグでのロールバックを拒む
- `--from` の既定は `git describe --tags --abbrev=0`、`--to` の既定は HEAD のタグかブランチ名
- 表（`types`）にない type の commit は捨てられる。commitlint が許す `revert` は既定の表になく、既定の表の `types`・`examples` は commitlint が許さない
- CLI は `chore(deps)` の commit を除くが、この除外は CLI の中にあり、ライブラリとして呼ぶと効かない
- `generateMarkDown` は、`noAuthors` に関係なく、作者のメールアドレスごとに `https://ungh.cc/users/find/<メール>` へ問い合わせる。`noAuthors` が効くのは、「❤️ Contributors」の節を出すかどうかだけ

この ADR は、ADR 0009 の R1（release-please のリリース PR で版を決める）と、ADR 0010 の U1（Release をきっかけにデプロイする）・G1（タグのコミットを出す）・N1（Release では `all`）を置き換える。ADR 0010 の H1（タグのルールセット）・E3（承認は1回）・Q1（`verify-ci` が CI を待つ）は残す。この ADR を足したあとも、#245 がマージされるまでは、今の release-please の流れが動いている。

## Decision Drivers

- DD1 正確さ: タグ・Release・CHANGELOG の版は、本番に出してデプロイが成功したコミットにだけ付く。Reject やデプロイの失敗では何も作らない。本番に何があるかは、これまでどおり production の Deployments と run の step の結果でも答えられる
- DD2 セキュリティ: タグ・Release・PR を書く権限は App の token だけが持ち、`release` の Environment（main だけ）の中で使う。production の job に App の鍵を持ち込まない。`v*` のタグを作れるのは App だけのまま。GITHUB_TOKEN に `contents: write` を渡さない。main のルールセットを緩めない
- DD3 運用の手間: dispatch 1回と承認1回で、デプロイと版が済む。上げるものがない auto や、続けられない状態は、承認の前に止まる。途中で失敗したら **Re-run failed jobs** で続きから動かせ、デプロイをやり直さずにタグだけを作り直せる。古い run を動かし直しても、本番を古いコミットで上書きしない。手元の状態に結果が左右されない
- DD4 変更容易性: 版の決まり（auto の判定、基準は最新の `v*` タグ）は自前の純粋関数に置き、テストで固定する
- DD5 学ぶ価値: 好きな UnJS の changelogen をライブラリとして使い、そのエコシステムに関わる

## Considered Options

全体の仕組み

- L1. 今のまま。release-please のリリース PR をマージしてタグと Release を作り、`release: published` でデプロイする（ADR 0009・0010）
- L2. changelogen の CLI に任せる。workflow で `changelogen --release` を動かし、できたリリースの commit を PR にして、タグと Release も changelogen が作る
- L3. dispatch で版を選んでデプロイし、成功したら workflow が、デプロイしたコミット（`github.sha`）にタグと Release を作る。CHANGELOG と `package.json` を更新する PR を App の token で作り、手でマージする。changelogen はライブラリとして、文面づくりだけに使う
- L4. 先にリリース PR を作る。dispatch で版を選び、workflow が CHANGELOG の PR を App で作る。それをマージしたら、もう一度 dispatch してデプロイし、成功したらマージしたコミットにタグを打つ（ADR 0009 の R5 を App の token で作る形）

デプロイの種類

- K1. `all` だけ（マイグレーション → API → 画面）
- K2. `web` を残し、`web` ではタグを作らない

版の入力（dispatch の欄）

- B1. `version` の文字列の欄を1つ。空なら auto、書けばその版
- B2. 選ぶ欄（auto / manual）と、`version` の文字列の欄の2つ
- B3. 選ぶ欄（auto / major / minor / patch）だけ

版の基準

- Z1. 最新の `v*` タグ
- Z2. ルートの `package.json` の `version`（changelogen の既定）

止める確かめ（版の判定、前の CHANGELOG の PR が開いていないか）の場所

- Y1. 承認の前（`verify-ci` の中）
- Y2. デプロイのあと（タグを打つ直前）

タグを打つ job

- J1. `deploy` job の最後の step（production の Environment の中）
- J2. 後続の `release` job（`needs: deploy`、`environment: release`）

承認の前に見せる

- G0. 見せない
- G1. `verify-ci` が、次の版・その理由・リリースノートの文面を run のまとめ（`$GITHUB_STEP_SUMMARY`）に書く
- G2. dispatch に `dry_run` の欄を足し、オンなら `verify-ci` だけを動かして終わる
- G3. G1 と G2 の両方

## Decision Outcome

採用する選択肢: 「L3（dispatch で版を選んでデプロイし、成功したコミットにタグと Release を作る。changelogen は文面だけ）」。あわせて K1・B3・Z1・Y1・J2・G1 を選ぶ。

流れは次のとおり。

1. deploy.yaml を `workflow_dispatch` で動かす。欄は `bump`（auto / major / minor / patch、既定は auto）だけ。`target` はなくす
2. `verify-ci`（Environment も secret も使わない）は、今までの確かめ（コミットが main にあり、必須のチェックが通っている）に加えて、次の版を決める。auto で上げるものがないときと、前の CHANGELOG の PR が開いているときは、ここで止まる。次の版・理由・文面を run のまとめに書く
3. `deploy`（production、承認1回）は、ブランチの上の run なら、最初の step で、最新の `v*` タグが `github.sha` の祖先（か同じ）であることと、前の CHANGELOG の PR が開いていないことを確かめ直す。そのあと、マイグレーション → API → 画面を出す
   - **Re-run failed jobs** は、成功済みの `verify-ci` を動かし直さない。`verify-ci` だけで確かめると、古い run を動かし直したときに素通りされ、あとから出た新しい版を古いコミットで上書きしうる。そのため、本番に出す直前のこの job の中でも確かめる。最新のタグが祖先であれば、出すコミットはこれまでに出したすべての版を含む
4. `release`（`needs: deploy`、`environment: release`、ブランチの上で動いたときだけ）は、App の token で、先に `CHANGELOG.md` と `package.json` の `version` を更新する PR を作り、次に文面を本文にした Release を作る。PR のブランチは `origin/main` から切り、題名は scope なしの `chore`。Release は `target_commitish` を `github.sha` にして、タグ `vX.Y.Z` も Release API に作らせる。どの手順も、すでにあれば飛ばす。タグがすでに別のコミットにあれば、飛ばさずに止まる。依存パッケージは入れず、版と文面は `verify-ci` から受け取る
5. CHANGELOG の PR は、その版の Release ができてから、手でマージする。本番には関係しない

`release` が途中で失敗しても、PR を先に作るので、タグだけが残ることはない。

- PR を作ったあとで失敗したときは、開いたままの CHANGELOG の PR が残り、次の dispatch はそれを見て承認の前に止まる
- PR を作る前に失敗したとき（App の token を作る、ブランチを push するなど）は、PR も Release も残らず、次の dispatch も止まらない。変更は次の版の CHANGELOG に入るので失われないが、それまで、デプロイしたコミットにタグがない
- どちらの場合も、失敗した run を **Re-run failed jobs** で動かして `release` を終わらせてから、新しく dispatch する。Re-run は、いちばん新しい run にだけ使う

版と文面の決まりは次のとおり。

- auto: 前のタグからの commit に破壊的変更（`!`）があれば major、なければ feat があれば minor、なければ fix か perf があれば patch。どれもなければ止まる
- major / minor / patch を選んだときは、commit がなくても、前のタグからその分だけ上げる
- 基準は最新の `v*` タグ
- CHANGELOG に出す type は feat・fix・perf・refactor・docs・revert。見出しは changelogen の既定のまま（`🚀 Enhancements` など）にし、既定の表にない revert は足す。chore・ci・test・build・style は出さない
- 「❤️ Contributors」の節は出さない。`generateMarkDown` には作者を消してから渡し、ungh.cc へ問い合わせない
- タグの上で dispatch したとき（前の版に戻すとき）は、版を決めず、`release` も動かさない
  - タグの上の run は、そのタグのコミットの deploy.yaml を使う（ADR 0010）。v1.3.0 までのタグの deploy.yaml には `target` の欄があり、既定は `web` なので、既定のまま動かすと画面だけが戻り、API の Worker は新しいまま残る。v1.3.0 までのタグに戻すときは、`target` に `all` を選ぶ

タグ `vX.Y.Z` は「この版を本番に出して、デプロイが成功したコミット」の印になる。ただし前の版に戻したときは、本番が最新のタグより古くなるので、本番に何があるかは、これまでどおり production の Deployments と run の step の結果で答える（deploy.md の「デプロイのあとに確かめる」の 0）。

理由:

- ADR 0009 が R4・R5 を採らなかった理由には、次のように答える
  - タグの2つの意味: K1 でデプロイはいつも全体になり、タグはデプロイの成功でしか作らない。画面だけのデプロイがないので、本番にない API の変更がタグに載ることはなく、#160 の仕組みは要らない。番号がすでに別のコミットのタグになっていることも、ふつうは起きない。次の版は最新のタグから数え、`concurrency` が run を1つずつ動かすので、次の run が版を数えるのは前の run がタグを打ったあとになる。それでも起きたら、飛ばさずに止める
  - 手元の状態: 版の判定と文面づくりは、`verify-ci` の中で、出すコミットの上で行う。手元では何も動かさない
  - DD7: 果たし終えた。代わりの学ぶ価値は DD5
- L3 は DD1 を最もよく満たす。タグが成功したデプロイのコミットに付くことを、仕組みで保証できるのは L3 だけ。判定が自前の純粋関数なので DD4 も満たす
  - L1 は DD1 と DD5 を満たさない。Reject や失敗でもタグと Release が残る
  - L2 は DD1 と DD3 を満たさない。タグが main の外に取り残され、docs だけでも patch に上がる。基準が `package.json` なので、CHANGELOG の PR をマージする前に次を動かすと、同じ版をもう一度作ろうとする
  - L4 は DD3 を満たさない。dispatch が2回要る。2回目は main の先頭を出すので、あいだに入った PR も一緒に出る（v1.0.0 のずれと同じ）。CHANGELOG が先に main に入るので、失敗や Reject では「CHANGELOG にあるのに版がない」も残る
- K1 は DD1 と DD4 を満たす。タグが本番の版とちょうど一致し、`TARGET` の分岐・step の `if`・テストの分岐が消える。K2 は、本番の最中に画面だけを直す道を残すが、その場面は想定しない。残すと、使わない道のために分岐とテストを保ち、「タグより新しい画面」という例外を抱え続ける
- B3 は DD3 を満たす。ドロップダウンなので、打ち間違いや古い版を入れようがない。手で上げたい場面（auto より大きく上げる、docs だけでも出す、major にする）はどれも選べる
  - B1 は任意の版を書けるが、正しい semver か、最新のタグより大きいかを確かめるコードが要る。番号を飛ばすことと pre-release は、npm に出すパッケージもベータを配る相手もないので、使う場面がない
  - B2 は、「auto なのに版も書いた」「manual なのに空」の組み合わせを止めるコードが要るわりに、得るものが小さい
- Z1 は DD1 と DD3 を満たす。CHANGELOG の PR を手でマージする設計なので、`package.json` は遅れうる。Z2 はそのあいだ古い版を指し、同じ版を二度作ろうとする
- Y1 は DD3 を満たす。だめな run は承認の画面まで来ない。Y2 は、本番に出たのにタグを打てない状態を作り、DD1 を満たさない。前の CHANGELOG の PR が開いたままだと、次の PR がその節を持たない main から切られて、競合するか節が抜けるので、この確かめも承認の前に置く。`release` が PR を先に作るので、同じ確かめが、`release` が途中で失敗した run も拾う
- J2 は DD2 と DD3 を満たす。App の鍵は `release`（main だけ）の中にとどまり、承認は production の1回のまま。`release` の段だけ失敗したら、**Re-run failed jobs** でデプロイをやり直さずに動かせる。J1 は App の鍵を Cloudflare のトークンと同じ job に入れ、タグだけのやり直しもできない
  - `release` で依存パッケージを入れないのは DD2 のため。書き込みの token を持つ job で、依存の install スクリプトや、ほかの job が書けるキャッシュの中身が動かないようにする
- G1 は DD3 と DD4 を満たす。承認を待つあいだ、終わった `verify-ci` のまとめは run の画面に出るので、版と文面を読んでから承認できる。気に入らなければ Reject すれば何も出ず、何も作られないので、Reject がそのまま下見になる。足すのはまとめに書く数行だけ
  - G0 は、版ができるまで何が出るか分からない
  - G2・G3 は、欄と `if` の分岐が増え、`concurrency`（今は workflow 全体）をどうするかも決め直すことになる（dry-run の run も同じ列に並ぶ）。下見は、#244 の CLI を手元で動かしてもできる

## Consequences

- 良い影響: タグ・Release・CHANGELOG は、成功したデプロイのコミットにだけできる。Reject やデプロイの失敗では何も残らない
- 良い影響: dispatch 1回と承認1回で、版と本番がそろう。承認の前に、`verify-ci` のまとめで版と文面を読める
- 良い影響: 版の判定が、純粋関数のテストで固定される
- 良い影響: release-please の設定・manifest・workflow・テストと、deploy.yaml の `TARGET` の分岐が消える。chore を CHANGELOG に出さないので、CHANGELOG の PR も Dependabot の PR も、次の CHANGELOG に載らない
- 悪い影響: 本番の最中に、画面だけを直して出す道がなくなる。本番の最中は何もデプロイしない。必要になったら、K2 に戻すかを決め直す
- 悪い影響: CHANGELOG の PR を手でマージするまで、main の `CHANGELOG.md` と `package.json` の `version` は、最新のタグより遅れる。前の PR を開いたままにすると、次の dispatch は承認の前に止まる
- 悪い影響: 番号を飛ばすことと pre-release は指定できない。要るようになったら、版の欄を足すかを決め直す
- 悪い影響: auto で上げるものがないと止まる。refactor や docs だけで版を出すときは、patch を選ぶ
- 悪い影響: Reject した run は、失敗として履歴に残る。production の Deployments に何が残るかは、まだ確かめていない
- 悪い影響: 自前の判定と、「すでにあれば飛ばす」workflow の手順を保つ。changelogen は 0.x なので、上げるたびに API の変化と `@deprecated` を確かめる
- 悪い影響: CHANGELOG の見出しが、v1.3.0 までの節（release-please が書いた日本語）と、これから（changelogen の英語と絵文字）で変わる。過去の節は書き換えない
- 悪い影響: `release` が途中で失敗すると、CHANGELOG の PR だけが開いたまま残る。**Re-run failed jobs** で `release` を終わらせるまで、次の dispatch は承認の前に止まる。Release ができる前にその PR をマージすると、この止める仕組みが効かなくなるので、マージは Release を確かめてからにする。PR を作る前に失敗したときは何も残らず、次の dispatch も止まらないので、run の失敗を見て自分で Re-run する
- 悪い影響: 新しい run のデプロイが成功し、その `release` が PR を作る前に失敗した状態では、タグも PR もないので、それより古い run の Re-run を `deploy` の確かめで止められない。Re-run は、いちばん新しい run にだけ使う
- 悪い影響: 前の版に戻したあとは、本番が最新のタグより古い。本番に何があるかは Deployments で読む
- 悪い影響: v1.3.0 までのタグに戻すときは、そのタグの deploy.yaml の `target` の欄で `all` を選ぶ必要がある。既定の `web` のままだと、画面だけが戻る
- 対応事項（#244）: `tools/release` の判定を B3 に合わせる（`bump` は auto / major / minor / patch。auto で上げるものがなければ止める）。`changelog.config.ts` は feat・fix・perf・refactor・docs・revert を出し、見出しは既定にして revert を足し、`noAuthors` を付ける。作者を消してから `generateMarkDown` に渡す。type が commitlint の type と合うことをテストする
- 対応事項（#245）: deploy.yaml から `target` を外して `bump` を足し、`release: published` を外す。`verify-ci` に版の判定・前の CHANGELOG の PR の確かめ・まとめを足す（タグと履歴を取り、PR を読む権限を足す）。`deploy` の最初に、最新の `v*` タグが祖先か・前の CHANGELOG の PR が開いていないかを確かめ直す step を足す。`release` job を足す（`needs: deploy`、`environment: release`、`if: github.ref_type == 'branch'`、依存を入れない）。release-please は同じ変更で外し、両方がタグを打つ期間を作らない。`deploy-workflow.test.ts`・runbook・operations.md・CLAUDE.md を直す。App の token の `issues` の権限と、App の Issues の権限・`autorelease` のラベルの扱いを手順に書く。deploy.md に、`release` が途中で失敗したときの動かし直し方と、v1.3.0 までのタグに戻すときは `target` に `all` を選ぶことを書く
- 対応事項（#244・#245）: 次のセキュリティと同時実行のケースを、自動テストで確かめる
  - App の token を作る step は `release` job にだけあり、`permission-issues` を渡さない。GITHUB_TOKEN の権限は、どの job でも書き込みを持たない
  - `release` job は `environment: release`・`needs: deploy`・`if: github.ref_type == 'branch'` を持ち、依存パッケージを入れる step（`pnpm install`、mise のキャッシュ）を持たない
  - production を使う job は `deploy` だけで、`verify-ci` は Environment も secret も使わない
  - `release: published` のきっかけがない。`concurrency` は `deploy-production`・`cancel-in-progress: false` のままで、`queue: max` を持たない（今あるテストを残す）
  - `release` の各手順の判定（タグがない → 作る、同じコミットにある → 飛ばす、別のコミットにある → 止める。Release と PR も、あれば飛ばす）と、`verify-ci` の止める条件（auto で上げるものがない、前の CHANGELOG の PR が開いている）と、`deploy` の最初の確かめ（最新の `v*` タグが `github.sha` の祖先でない、前の CHANGELOG の PR が開いている）は、純粋関数にしてテストする。途中で失敗したあとの Re-run で重複ができないことは、この判定のテストで確かめる
  - `deploy` の確かめの step は、ブランチの上の run で、Cloudflare の secret を読むどの step よりも前にある
- 対応事項（#246）: 本番で通して確かめる。Reject した run が production の Deployments に何を残すかも確かめる
- 対応事項: #242・#244・#245・#246 の本文を、この ADR（target をなくす、bump の選択肢、出す type、見出し）に合わせて直す
- 対応事項: ADR 0005・0009・0010 の置き換わった決定のところに、この ADR を指す一言を足す（Status は accepted のまま。置き換わるのは一部だけ）。docs/README.md の一覧と、CLAUDE.md の ADR の範囲を直す
