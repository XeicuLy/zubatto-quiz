# リリース（番号・CHANGELOG・タグ・GitHub Release）

版は、本番のデプロイ（deploy.yaml）を main の上で動かすときに、`bump`（auto / major / minor / patch）で選ぶ。デプロイが成功したら、デプロイしたコミットにタグ `vX.Y.Z` と GitHub Release を作り、CHANGELOG と `package.json` の `version` を更新する PR を開く。PR は手でマージする。決めた理由は [ADR 0012](../adr/0012-release-after-deploy-with-changelogen.md) にある。

- タグ `vX.Y.Z` は「この版を本番に出して、デプロイが成功したコミット」の印になる。承認を Reject したときや、デプロイが失敗したときは、何も作らない
- ただし前の版に戻したあとは、本番が最新のタグより古くなる。本番の Worker がどのコミット・どの版かは、[deploy.md の「デプロイのあとに確かめる」](deploy.md#デプロイのあとに確かめる)の 0 で読む
- v1.3.0 までは、release-please のリリース PR で版を決め、できた Release でデプロイしていた（ADR 0009・0010）。v1.3.0 までの CHANGELOG の節とタグは、そのときの形のまま残す

## 何が動くか

| workflow                                               | いつ                                | 何をするか                                                                                                          |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [pr-title.yaml](../../.github/workflows/pr-title.yaml) | main への PR（題名の編集も）と push | PR の題名（push では main のコミット名）を commitlint で確かめる。main のルールセットの必須のチェック（`pr-title`） |
| [deploy.yaml](../../.github/workflows/deploy.yaml)     | 手で動かしたとき                    | 版を決め、承認を待ってから本番に出し、成功したらタグ・Release・CHANGELOG の PR を作る（[deploy.md](deploy.md)）     |

deploy.yaml を main の上で動かすと、版とリリースのために次が動く。

1. `verify-ci` が、最新の `v*` タグを基準にして次の版を決め、リリースノートの文面を作る（`tools/release`）。版・理由・文面は run のまとめ（Summary）に出る。続けられない状態なら、承認の前に止まる（[deploy.md の「何が動くか」](deploy.md#何が動くか)）
2. `deploy` が、最初に基準のタグを確かめ直してから、本番に出す
3. `release` が、次の順に作る。どの手順も、すでにあれば飛ばすので、途中で落ちても **Re-run failed jobs** で続きから動かせる
   1. タグ `vX.Y.Z` がすでにデプロイしたコミットにあれば、前の Re-run で終わっているので、何もしない。別のコミットにあるか、最新の `v*` タグが基準のタグと違えば、何も作らずに止まる
   2. ブランチ `changelog/vX.Y.Z` の PR が、開いているかマージ済みなら、3〜5 は前の run で済んでいるので飛ばす（閉じただけの PR は数えない）
   3. main の先頭から、ブランチ `changelog/vX.Y.Z` を切る。前の run が PR を作る前に落ちて残したブランチがあれば、それを使う
   4. そのブランチの `CHANGELOG.md` の先頭に文面を置き、ルートの `package.json` の `version` を書き換える。同じ版の節がすでにあれば、今回の文面で置き換える（残ったブランチが、別のコミットの run の文面のままにならないように）。GitHub の API（contents API）でコミットするので、コミットには GitHub の署名（Verified）が付く
   5. PR（`chore: vX.Y.Z の CHANGELOG を更新する`）を開く
   6. GitHub Release `vX.Y.Z` を、デプロイしたコミット（`target_commitish` が `github.sha`）に作る。タグも、このとき Release の API が作る

- PR を先に作るのは、途中で落ちたときに、タグだけが残らないようにするため。開いたままの PR が残り、次の dispatch はそれを見て承認の前に止まる
- `release` は GitHub App の token で書く。GITHUB_TOKEN で作った PR では、ci / e2e が「承認待ち」になって自動では動かないため。GITHUB_TOKEN には、どの job でも書き込みの権限を渡さない
- `release` は、main だけに絞った Environment `release` で動き、App の秘密鍵はそこにだけ置く。依存パッケージを入れず、node だけで動く。中身は [.github/scripts/release.sh](../../.github/scripts/release.sh) と `tools/release/src/steps.ts`
- タグの上で動かしたとき（出し直すとき・前の版に戻すとき）は、版を決めず、`release` も動かない
- マージは squash だけにしている。PR 1つが main の1コミットになり、その題名が CHANGELOG の1行になる

## 番号の上がり方

`bump` が `auto` なら、前のタグからの main のコミット（squash なので PR の題名）の type で決まる。文面の見出しは changelogen の既定のまま（[changelog.config.ts](../../changelog.config.ts)）。

| PR の題名                                        | CHANGELOG の節               | auto での番号          |
| ------------------------------------------------ | ---------------------------- | ---------------------- |
| `feat!: ...` など、type のあとに `!`             | 元の節と ⚠️ Breaking Changes | major（1.3.0 → 2.0.0） |
| `feat: ...`                                      | 🚀 Enhancements              | minor（1.3.0 → 1.4.0） |
| `fix: ...`                                       | 🩹 Fixes                     | patch（1.3.0 → 1.3.1） |
| `perf: ...`                                      | 🔥 Performance               | patch                  |
| `refactor: ...`                                  | 💅 Refactors                 | 上げない               |
| `docs: ...`                                      | 📖 Documentation             | 上げない               |
| `revert: ...`（GitHub の Revert ボタンの題名も） | ⏪ Reverts                   | 上げない               |
| `chore`・`ci`・`test`・`build`・`style`          | 出ない                       | 上げない               |

- auto で上げるものがなければ、`verify-ci` が止まる。refactor や docs だけで版を出すときは、`patch` を選ぶ
- `major`・`minor`・`patch` を選ぶと、上げる理由になる commit がなくても、前のタグからその分だけ上げる。番号を飛ばすことと pre-release は選べない
- 基準は最新の `v*` タグで、`package.json` の `version` ではない。CHANGELOG の PR をマージするまで、`package.json` は最新のタグより遅れる
- squash の本文は空にしているので、破壊的変更は題名の `!` で表す。本文の `BREAKING CHANGE:` は main に残らない
- 作者の節（❤️ Contributors）は出さない
- CHANGELOG の PR（chore）と Dependabot の PR（chore・ci）は、次の CHANGELOG に載らない

## はじめに一度だけ用意するもの

リポジトリを作り直したときも、この順で行う。

### 1. GitHub App を作る

1. GitHub の Settings → Developer settings → GitHub Apps → New GitHub App を開く
2. 次のとおりに入れる
   - GitHub App name: 空いている名前（例: `zubakui-release`）。GitHub 全体で重ならない名前にする
   - Homepage URL: このリポジトリの URL
   - Webhook: Active を外す（使わない）
   - Repository permissions: Contents・Pull requests を Read and write にする。Metadata は Read-only のまま
   - Where can this GitHub App be installed?: Only on this account
3. Create GitHub App を押し、出てきた画面の Client ID を控える
4. 秘密鍵は、App の設定の `key_pairs` のページ（`https://github.com/settings/apps/<App の名前>/key_pairs`）で Generate a private key を押して作る。秘密鍵（`.pem`）がダウンロードされる。General の画面には出ない（2026-10-28 に確かめた）。隣の `client_secrets`（Client secret）は人がこの App でログインするためのもので、作らない
   - 鍵はすぐ下の 3 で secret に入れて消すので、2 で Environment を作ってから作るとよい
5. 左の Install App から、このアカウントに入れる。Only select repositories で `zubatto-quiz` だけを選ぶ

権限の理由: Contents は CHANGELOG の PR のブランチ・`package.json`・CHANGELOG・Release とタグを書くため、Pull requests は CHANGELOG の PR を開くため。ラベルは使わないので、Issues は要らない。workflow の中でも、token の権限を `contents` と `pull-requests` の書き込みだけに絞る。

### 2. Environment `release` を作り、main だけに絞る

App の秘密鍵は、main の workflow からしか読めないように、Environment の secret に置く。

```sh
gh api -X PUT repos/XeicuLy/zubatto-quiz/environments/release \
  -F can_admins_bypass=false \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/XeicuLy/zubatto-quiz/environments/release/deployment-branch-policies -f name=main -f type=branch
```

- `can_admins_bypass` を `false` にする。`true`（作ったときの既定）だと、管理者は「main だけ」の決まりを飛ばせ、main 以外のブランチの workflow にも鍵が渡りうる
- `release` の job は、main の上で動かした run でだけ動く（タグの上では動かない）ので、`v*` のタグは許さない

画面では Settings → Environments → New environment で `release` を作り、Deployment branches and tags を Selected branches and tags にして `main` を足す。

### 3. Client ID と秘密鍵を入れる

```sh
gh variable set RELEASE_APP_CLIENT_ID --env release --body '<Client ID>'
gh secret set RELEASE_APP_PRIVATE_KEY --env release < ~/Downloads/<ダウンロードした鍵>.pem
rm ~/Downloads/<ダウンロードした鍵>.pem
```

- Client ID は秘密ではないので、secret ではなく変数（`vars`）に置く
- 秘密鍵は入れたらすぐ消す。リポジトリにも、ほかの場所にも残さない。なくしたら作り直せばよい（下の「秘密鍵を入れ替える」）

### 4. マージの方法を squash だけにする

```sh
gh api -X PATCH repos/XeicuLy/zubatto-quiz \
  -F allow_merge_commit=false -F allow_rebase_merge=false -F allow_squash_merge=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=BLANK
```

- 題名は PR の題名、本文は空にする。本文にコミットの一覧が入ると、その中の `feat: ...` なども1行として数えられる
- main のルールセット（`allowed_merge_methods` と、必須のチェックの `pr-title`）でも squash だけにする（[branch-protection.md](branch-protection.md#設定を変える)）

確かめる:

```sh
gh api repos/XeicuLy/zubatto-quiz --jq '{allow_merge_commit, allow_rebase_merge, allow_squash_merge, squash_merge_commit_title, squash_merge_commit_message}'
```

### 5. v\* のタグを App だけが作れるようにする

`v*` のタグは本番への入口になるので（ADR 0010）、タグを作る・動かす・消すのを、1 の App だけに許すルールセットを入れる。`release` の job は、この App の token で Release を作り、そのときにタグもできる。

1. App の設定画面（`https://github.com/settings/apps/<App の名前>`）の About に出る **App ID**（数字）を読む。3 で入れた Client ID とは別のもの
2. `docs/runbooks/release-tag-ruleset.json` の `bypass_actors[0].actor_id` が、その App ID と同じかを見る。違えば直す PR を出す（App を作り直したときなど）
3. [branch-protection.md の「タグのルールセットを作る」](branch-protection.md#タグのルールセットを作る)の手順で作る
4. 作ったあとで、production の Environment に `v*` のタグを許す（[deploy.md](deploy.md#github-の-environmentproductionを作る)）。逆の順にしない

打ち間違えたタグを消すときは、ルールセットを一時的に止める（[branch-protection.md の「打ち間違えたタグを消す」](branch-protection.md#打ち間違えたタグを消す)）。

## release-please から切り替える（一度だけ）

v1.3.0 までの release-please の流れから、この流れに切り替えた PR（#245）のときに、一度だけ行う。

1. マージする前に、release-please のリリース PR が開いていないことを確かめる。開いていれば閉じる

   ```sh
   gh pr list --state open --label 'autorelease: pending' --json number,title
   ```

2. 切り替えの PR をマージする。release-please の workflow・設定・manifest は同じ PR で消えるので、2つの仕組みが同時にタグを打つ期間はない
3. App の権限から Issues を外す。App の設定画面（`https://github.com/settings/apps/<App の名前>/permissions`）の Repository permissions で、Issues を No access にして保存する。権限を減らすときは、インストール先での承認は要らない
4. release-please が使っていたラベルを消す。過去のリリース PR に付いていたラベルも外れるが、ほかに使っている場所はない

   ```sh
   gh label delete 'autorelease: pending' --yes
   gh label delete 'autorelease: tagged' --yes
   ```

5. 最初の版を出す（[deploy.md の「版を出す」](deploy.md#版を出すふだん)）。基準は v1.3.0 になる。CHANGELOG の見出しは、v1.3.0 までの日本語の節（release-please が書いた形）から、changelogen の英語と絵文字の節に変わる。過去の節は書き換えない

## ふだんのリリース

1. PR の題名を Conventional Commits の形にする（[CONTRIBUTING](../../CONTRIBUTING.md#pr-の題名とコミットメッセージ)）。`pr-title` が確かめる
2. PR を squash でマージする。マージしただけでは、版もデプロイも動かない
3. 出したくなったら、deploy.yaml を main の上で動かす（[deploy.md の「版を出す」](deploy.md#版を出すふだん)）。run のまとめで次の版と文面を読んでから承認する。気に入らなければ Reject する（何も作られない）
4. `release` が終わったら、タグ・Release・CHANGELOG の PR ができたことを確かめ、下の手順で CHANGELOG の PR をマージする

## CHANGELOG の PR をマージする

1. その版の Release ができていることを確かめる

   ```sh
   gh release view vX.Y.Z --json tagName,targetCommitish,url
   ```

2. PR の ci / e2e / pr-title が通ったら、squash でマージする

- **Release ができる前にマージしない**。`release` が PR を作ったあとで落ちたとき、開いた PR が次の dispatch を止めて知らせる。先にマージすると、この止める仕組みが効かなくなる（[deploy.md の「release が途中で失敗したとき」](deploy.md#release-が途中で失敗したとき)）
- 開いている間は、次の dispatch が承認の前に止まる。マージを忘れない
- 題名は `chore:` なので、次の CHANGELOG に出ず、版も上げない
- 行を直したいときは、マージする前に、PR のブランチで `CHANGELOG.md` を直してよい。PR があれば、`release` を Re-run してもブランチとファイルには触れないので、直した節は書き戻されない。Release の本文も同じに直すときは、`gh release edit vX.Y.Z --notes-file <ファイル>` か、Release の画面の Edit で直す
- 件名が利用者に通じない行が出ないよう、元の PR の題名を、利用者から見て何が変わったかで書く

## 失敗したとき

`release` を動かし直す手順は、[deploy.md の「release が途中で失敗したとき」](deploy.md#release-が途中で失敗したとき)にある。

| 症状                                                                    | 原因と直し方                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release` が `Create GitHub App token` で落ちる                         | Client ID か秘密鍵が違う、または App がこのリポジトリに入っていない。上の 1〜3 を見直してから、Re-run する                                                                                               |
| `release` が `release` の Environment で止まる・待つ                    | Environment の branch の絞り込みに main がない。2 を見直す                                                                                                                                               |
| `Publish release` が Release を作るところで落ち、ルールに拒まれたと出る | `v*` のタグのルールセットの bypass が、この App になっていない。`actor_id` に Client ID を入れたか、App を作り直して App ID が変わった。上の 5 を見直してから、Re-run する                               |
| `Publish release` が「Resource not accessible by integration」で落ちる  | App か token に、Contents か Pull requests の書き込みがない。上の 1 と、deploy.yaml の `permission-*` を見直す                                                                                           |
| `Publish release` が「… はすでに別のコミット（…）にある」で止まる       | 同じ番号のタグが、ほかのコミットにある。どちらが本番の版かを確かめ、打ち間違いなら消してから（[branch-protection.md](branch-protection.md#打ち間違えたタグを消す)）、Re-run する                         |
| CHANGELOG の PR の ci / e2e が「承認待ち」になる                        | GITHUB_TOKEN で作られている。`Publish release` の `GH_TOKEN` が App の token になっているかを見る                                                                                                        |
| PR のマージのボタンが押せず、`pr-title` が落ちている                    | PR の題名が Conventional Commits の形でない。題名を直すと、`pr-title` が自動で動き直す                                                                                                                   |
| CHANGELOG に同じ変更が2行ずつ出る                                       | マージコミットで入った PR がある。4 の設定を見直す。出てしまった行は、CHANGELOG の PR のブランチで消してからマージする                                                                                   |
| CHANGELOG の PR に、前の版の節がない（競合する）                        | 前の CHANGELOG の PR をマージせずに、次の版を出した。ふつうは `verify-ci` が止めるが、止まらなかったときは、前の PR を先にマージし、次の PR のブランチに main を取り込んで、節の順を直してからマージする |

## 秘密鍵を入れ替える

漏れたかもしれないとき、または定期的に入れ替えるとき。

1. App の設定の `key_pairs` のページで、新しい鍵を作る（古い鍵はまだ消さない）
2. 上の 3 のコマンドで `RELEASE_APP_PRIVATE_KEY` を入れ直し、ダウンロードした鍵を消す
3. `key_pairs` のページで、古い鍵を消す。漏れたかもしれないときは、すぐ消す
4. 次に版を出したとき、`release` の `Create GitHub App token` が通ることを確かめる。落ちたら、鍵を入れ直してから、その run の `release` を Re-run する

App そのものをやめるときは、App の設定画面の Advanced から Delete GitHub App を押し、Environment `release` も消す。`v*` のタグのルールセットの bypass は消えた App を指したまま残るので、新しい App に替えるときは、5 の手順で `actor_id` を新しい App ID にして当て直す。
