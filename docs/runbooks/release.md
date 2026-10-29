# リリース（番号・CHANGELOG・タグ・GitHub Release）

版の番号と CHANGELOG は、release-please が開く「リリース PR」で決める。リリース PR をマージすると、そのコミットにタグ `vX.Y.Z` と GitHub Release ができる。決めた理由は [ADR 0009](../adr/0009-release-versioning-and-tagging.md) にある。

- タグは「この版ができた」印で、本番に出た印ではない。本番の Worker がどのコミット・どの版かは、[deploy.md の「デプロイのあとに確かめる」](deploy.md#デプロイのあとに確かめる)の 0 で読む
- リリース PR をマージすると、できた Release で本番のデプロイ（deploy.yaml）が動き始め、承認を待つ。承認すると、タグのコミットが本番に出る（ADR 0010）。承認しなければ出ないが、本番の最中はリリース PR をマージしない（[deploy.md の「動かす」](deploy.md#動かす)）

## 何が動くか

| workflow                                                           | いつ                                   | 何をするか                                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [release-please.yaml](../../.github/workflows/release-please.yaml) | main への push                         | リリース PR を開くか更新する。リリース PR がマージされたときは、タグと GitHub Release を作る                        |
| [pr-title.yaml](../../.github/workflows/pr-title.yaml)             | main への PR（題名の編集も）と push    | PR の題名（push では main のコミット名）を commitlint で確かめる。main のルールセットの必須のチェック（`pr-title`） |
| [deploy.yaml](../../.github/workflows/deploy.yaml)                 | Release ができたとき（手でも動かせる） | main の CI を待ってから、タグのコミットを本番に出す。出す前に承認を待つ（[deploy.md](deploy.md)）                   |

- 設定は [release-please-config.json](../../release-please-config.json)、今の版は [.release-please-manifest.json](../../.release-please-manifest.json) にある。版の番号は、ルートの `package.json` の `version` にも書かれる
- release-please は GitHub App の token で動く。GITHUB_TOKEN で作った PR では、ci / e2e が「承認待ち」になって自動では動かないため
- マージは squash だけにしている。PR 1つが main の1コミットになり、その題名が CHANGELOG の1行になる

## 番号の上がり方

PR の題名（Conventional Commits）の type で決まる。

| PR の題名                                      | CHANGELOG        | 番号                   |
| ---------------------------------------------- | ---------------- | ---------------------- |
| `feat: ...`                                    | 「新機能」に出る | minor（1.2.0 → 1.3.0） |
| `fix: ...`                                     | 「修正」に出る   | patch（1.2.0 → 1.2.1） |
| `perf: ...`                                    | 「性能」に出る   | patch                  |
| `feat!: ...` など、type のあとに `!`           | BREAKING に出る  | major（1.2.0 → 2.0.0） |
| `docs`・`test`・`ci`・`chore`・`refactor` など | 出ない           | 上げない               |

- 前のリリースから `docs` や `ci` だけしか入っていなければ、リリース PR は作られない（release-please-action v5.0.0 の中の release-please 17.6.0 のソースで確かめた。2026-10-27）
- squash の本文は空にしているので、BREAKING は題名の `!` で表す。本文の `BREAKING CHANGE:` は main に残らない

## はじめに一度だけ用意するもの

リポジトリを作り直したときも、この順で行う。

### 1. GitHub App を作る

1. GitHub の Settings → Developer settings → GitHub Apps → New GitHub App を開く
2. 次のとおりに入れる
   - GitHub App name: 空いている名前（例: `zubakui-release`）。GitHub 全体で重ならない名前にする
   - Homepage URL: このリポジトリの URL
   - Webhook: Active を外す（使わない）
   - Repository permissions: Contents・Pull requests・Issues を Read and write にする。Metadata は Read-only のまま
   - Where can this GitHub App be installed?: Only on this account
3. Create GitHub App を押し、出てきた画面の Client ID を控える
4. 秘密鍵は、App の設定の `key_pairs` のページ（`https://github.com/settings/apps/<App の名前>/key_pairs`）で Generate a private key を押して作る。秘密鍵（`.pem`）がダウンロードされる。General の画面には出ない（2026-10-28 に確かめた）。隣の `client_secrets`（Client secret）は人がこの App でログインするためのもので、作らない
   - 鍵はすぐ下の 3 で secret に入れて消すので、2 で Environment を作ってから作るとよい
5. 左の Install App から、このアカウントに入れる。Only select repositories で `zubatto-quiz` だけを選ぶ

権限の理由: Contents はリリース PR のブランチ・`package.json`・CHANGELOG・タグを書くため、Pull requests はリリース PR を開くため、Issues はリリース PR に付けるラベル（`autorelease: pending` と `autorelease: tagged`）のため。release-please は、マージ済みのリリース PR をこのラベルで探す。

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

- 題名は PR の題名、本文は空にする。本文にコミットの一覧が入ると、release-please がその中の `feat: ...` も1行として拾う
- release-please を入れる PR をマージする**前に**行う。マージコミットで入ると、その本文の PR の題名と PR の中のコミットが両方数えられ、最初のリリース PR に同じ変更が2行ずつ出る
- main のルールセット（`allowed_merge_methods` と、必須のチェックの `pr-title`）は、その PR をマージした**あとで**当てる（[branch-protection.md](branch-protection.md#設定を変える)）

確かめる:

```sh
gh api repos/XeicuLy/zubatto-quiz --jq '{allow_merge_commit, allow_rebase_merge, allow_squash_merge, squash_merge_commit_title, squash_merge_commit_message}'
```

### 5. v\* のタグを App だけが作れるようにする

`v*` のタグは本番への入口になるので（ADR 0010）、タグを作る・動かす・消すのを、1 の App だけに許すルールセットを入れる。

1. App の設定画面（`https://github.com/settings/apps/<App の名前>`）の About に出る **App ID**（数字）を読む。3 で入れた Client ID とは別のもの
2. `docs/runbooks/release-tag-ruleset.json` の `bypass_actors[0].actor_id` が、その App ID と同じかを見る。違えば直す PR を出す（App を作り直したときなど）
3. [branch-protection.md の「タグのルールセットを作る」](branch-protection.md#タグのルールセットを作る)の手順で作る
4. 作ったあとで、production の Environment に `v*` のタグを許す（[deploy.md](deploy.md#github-の-environmentproductionを作る)）。逆の順にしない

打ち間違えたタグを消すときは、ルールセットを一時的に止める（[branch-protection.md の「打ち間違えたタグを消す」](branch-protection.md#打ち間違えたタグを消す)）。

## ふだんのリリース

1. PR の題名を Conventional Commits の形にする（[CONTRIBUTING](../../CONTRIBUTING.md#pr-の題名とコミットメッセージ)）。`pr-title` が確かめる
2. PR を squash でマージする。main に入るたびに、release-please がリリース PR（`chore: vX.Y.Z をリリースする`）を開くか更新する
3. 出したくなったら、リリース PR を開いて CHANGELOG を読む。件名が利用者に通じない行は、下の「CHANGELOG の行を直す」の方法で直す
4. ci / e2e / pr-title が通ったら、リリース PR を squash でマージする。マージすると本番のデプロイが動き始めるので、本番の最中はマージしない（ADR 0006）
5. 数分たったら、タグと Release ができたことを確かめる

   ```sh
   git fetch --tags
   git tag --list 'v*' --sort=-v:refname | head -1
   gh release view --json tagName,url --jq '"\(.tagName) \(.url)"'
   ```

6. Release で deploy.yaml が動き、main の CI が終わるのを待ってから、承認を待つ。[deploy.md の「Release で動かす」](deploy.md#release-で動かすふだん)の手順で承認する

## 最初のリリース（v1.0.0）のあと

`release-please-config.json` の `bootstrap-sha` と `packages["."]["release-as"]`（`1.0.0`）は、最初のリリースのためだけのもの。v1.0.0 のタグと Release ができたことを確かめたら、両方を消す PR を出す。このリポジトリでは 2026-10-28 に v1.0.0 を出し、両方を消した（#161）。リポジトリを作り直して一から始めるときは、両方を足し直す。`tools/docs-check` のテストは、manifest に版があるのにこの2つが残っていると落ちる

- `release-as` を残すと、次のリリース PR も 1.0.0 を作ろうとする。`bootstrap-sha` は、リリース PR が1度マージされたあとは読まれないが、残すと読み手が迷う
- その PR の題名は `chore:` にする（CHANGELOG に出ず、リリース PR も作られない）
- 消したあとの最初の feat / fix / perf の PR をマージしたら、リリース PR の題名が `chore: v1.1.0 をリリースする`（fix / perf だけなら `v1.0.1`）になっていることを確かめる。`.release-please-manifest.json` には、v1.0.0 のリリース PR のマージで `{ ".": "1.0.0" }` が書かれている

## CHANGELOG の行を直す

リリース PR のブランチで CHANGELOG.md を直しても、main が進むたびに release-please が書き戻す。行を直すときは、その行の元になった（マージ済みの）PR の本文の最後に、次の形で書く。

```text
BEGIN_COMMIT_OVERRIDE
feat: 利用者に通じる件名
fix: 同じ PR で直したもう1つのこと
END_COMMIT_OVERRIDE
```

- release-please は、PR の本文にこの区切りがあると、その PR のコミットを中の行で置き換えて読む。1行が1つの変更になり、type で節と番号の上がり方が決まる。行を消せば CHANGELOG から外せる（`chore: ...` だけにするなど）
- **本文の地の文に `BEGIN_COMMIT_OVERRIDE` という言葉を書かない**。release-please は本文を最初に出てきたこの言葉で区切り、そのうしろから読む。#164 では説明の文にこの言葉を書いていたため、そこから読まれてパースに失敗し、リリース PR が作られなかった（2026-10-28）。区切りの2行は、本文の最後に1回だけ書く
- CHANGELOG の行の並びは、書いた順ではなく、release-please が節の中で並べ替える
- 本文を直したら、Actions の画面で main の release-please の run を動かし直すと、リリース PR に反映される
- `ci:` や `docs:` の PR に `feat:` の行を書くと、番号も上がる。利用者から見て何が変わったかで選ぶ
- 2026-10-27 に、release-please 17.6.0 のライブラリに例のコミットを渡して確かめた

## 失敗したとき

| 症状                                                                        | 原因と直し方                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| release-please の run が `Create GitHub App token` で落ちる                 | Client ID か秘密鍵が違う、または App がこのリポジトリに入っていない。上の 1〜3 を見直す                                                                                                                                                                                                                                                                                 |
| release-please の run が `release` の Environment で止まる・待つ            | Environment の branch の絞り込みに main がない。2 を見直す                                                                                                                                                                                                                                                                                                              |
| リリース PR の ci / e2e が「承認待ち」になる                                | GITHUB_TOKEN で動いている。workflow の `token:` が App の token になっているかを見る                                                                                                                                                                                                                                                                                    |
| PR のマージのボタンが押せず、`pr-title` が落ちている                        | PR の題名が Conventional Commits の形でない。題名を直すと、`pr-title` が自動で動き直す                                                                                                                                                                                                                                                                                  |
| リリース PR に同じ変更が2行ずつ出る                                         | マージコミットで入った PR がある。4 の設定を見直す。出てしまった行は、その PR の本文の `BEGIN_COMMIT_OVERRIDE` で1行にする（上の「CHANGELOG の行を直す」）                                                                                                                                                                                                              |
| リリース PR をマージしたのにタグができない                                  | release-please の run のログを見る。リリース PR に `autorelease: pending` のラベルがないと、マージ済みのリリース PR として見つけられない。ラベルを付けて、main の run を動かし直す                                                                                                                                                                                      |
| release-please の run が Release を作るところで落ち、ルールに拒まれたと出る | `v*` のタグのルールセットの bypass が、この App になっていない。`actor_id` に Client ID を入れたか、App を作り直して App ID が変わった。上の 5 を見直す                                                                                                                                                                                                                 |
| main の変更（設定や package.json）がリリース PR に入らない                  | release-please は、リリースノートが変わったときだけ、リリース PR のファイルを作り直す。`ci:` や `docs:` だけの PR では、リリース PR は前の main から作ったファイルのまま残る（ログに「remained the same」）。リリース PR の本文に1行足してから、main の release-please の run を動かし直す。本文が違うので作り直され、足した行も消える（2026-10-28 に #165 で確かめた） |

## 秘密鍵を入れ替える

漏れたかもしれないとき、または定期的に入れ替えるとき。

1. App の設定の `key_pairs` のページで、新しい鍵を作る（古い鍵はまだ消さない）
2. 上の 3 のコマンドで `RELEASE_APP_PRIVATE_KEY` を入れ直し、ダウンロードした鍵を消す
3. main の release-please の run を動かし直し（Actions の画面の Re-run）、通ることを確かめる
4. `key_pairs` のページで、古い鍵を消す

App そのものをやめるときは、App の設定画面の Advanced から Delete GitHub App を押し、Environment `release` も消す。`v*` のタグのルールセットの bypass は消えた App を指したまま残るので、新しい App に替えるときは、5 の手順で `actor_id` を新しい App ID にして当て直す。
