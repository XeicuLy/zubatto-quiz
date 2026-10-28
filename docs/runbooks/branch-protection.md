# ルールセット（main と v\* のタグ）

main ブランチと `v*` のタグは、リポジトリのルールセット（Settings → Rules → Rulesets）で守る。classic のブランチ保護（Settings → Branches）は使わない。

- main のルールセット: CI が通らないと main にマージできないようにする（M1）。設定の正本は [main-ruleset.json](main-ruleset.json)
- `v*` のタグのルールセット: `v*` のタグを作れる（動かせる・消せる）のを release-please の App だけにする（ADR 0010）。設定の正本は [release-tag-ruleset.json](release-tag-ruleset.json)。[下の「v\* のタグのルールセット」](#v-のタグのルールセット)

どちらも、正本の JSON を `gh api` に渡せば一から作り直せる。

## 何を決めているか

| 項目                                                 | 値                                                    | なぜ                                                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 対象                                                 | 既定のブランチ（`~DEFAULT_BRANCH`）                   | main の名前を変えても、そのまま効く                                                                                                                                                                         |
| 削除の禁止（`deletion`）                             | あり                                                  | main を消せないようにする                                                                                                                                                                                   |
| force push の禁止（`non_fast_forward`）              | あり                                                  | main の履歴を書き換えられないようにする                                                                                                                                                                     |
| PR 必須（`pull_request`）                            | 承認は0件                                             | 1人で開発しているので、承認は求めない。直接 push はできない                                                                                                                                                 |
| マージの方法                                         | squash だけ                                           | PR 1つが main の1コミットになり、その題名が CHANGELOG の1行になる（ADR 0009・[release.md](release.md)）                                                                                                     |
| CodeQL（`code_scanning`）                            | セキュリティの警告は high 以上、ほかは error で止める |                                                                                                                                                                                                             |
| Code Quality（`code_quality`）                       | error で止める                                        |                                                                                                                                                                                                             |
| 必須のステータスチェック（`required_status_checks`） | `ci`・`e2e`・`pr-title`                               | `ci` と `e2e`（通しの E2E）は `.github/workflows/ci.yaml`、`pr-title`（PR の題名の確認）は `pr-title.yaml` の job 名。どれも main への push でも動かす。デプロイの `verify-ci` が main のコミットで探すため |
| チェックを送ってよいアプリ（`integration_id`）       | `15368`                                               | GitHub Actions のアプリの ID。ほかの仕組みが同じ名前で成功を送ってきても、必須のチェックの結果として使わない                                                                                                |
| strict（main に追いついていることを求める）          | なし                                                  | 1人で開発しているので、PR を出すたびに main を取り込み直す手間を省く                                                                                                                                        |
| bypass                                               | なし                                                  | admin も例外にしない。CI が通らない PR は、誰もマージできない                                                                                                                                               |

## 今の設定を見る

```sh
gh api repos/XeicuLy/zubatto-quiz/rulesets
gh api repos/XeicuLy/zubatto-quiz/rulesets/<id>
```

一覧の `id` を2つ目のコマンドに入れる。`main-ruleset.json` と見比べて、違っていたらどちらかを直す。

## 一から作り直す

リポジトリを作り直したときや、ルールセットを消してしまったときは、リポジトリのいちばん上で次を実行する。

```sh
gh api -X POST repos/XeicuLy/zubatto-quiz/rulesets --input docs/runbooks/main-ruleset.json
```

- `main-ruleset.json` には、`id`・`_links`・`created_at` など、GitHub が付ける項目を入れていない。入っていると作れないので、`gh api` で取り出した JSON から写すときは、これらを消す
- 作ったら、適当な PR で `ci`・`e2e`・`pr-title` が必須のチェックとして表示され、通るまでマージのボタンが押せないことを確かめる

## 設定を変える

画面かコマンドで変えたら、`main-ruleset.json` も同じにそろえる。今の設定から、GitHub が付ける項目を除いて書き出せる。

```sh
gh api repos/XeicuLy/zubatto-quiz/rulesets/<id> \
  | jq '{name, target, enforcement, conditions, rules, bypass_actors}' > docs/runbooks/main-ruleset.json
pnpm run fmt   # jq の出力は oxfmt の形と違うので、整えないと fmt:check が落ちる
```

先に `main-ruleset.json` を直したとき（必須のチェックを足すなど）は、その PR をマージしたあとで、今のルールセットに当てる。マージの前に当てると、まだ新しい job を持たないほかの PR が、来ないチェックを待ってマージできなくなる。

```sh
gh api -X PUT repos/XeicuLy/zubatto-quiz/rulesets/<id> --input docs/runbooks/main-ruleset.json
```

当てたら、`gh api repos/XeicuLy/zubatto-quiz/rulesets/<id> --jq '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks'` で、必須のチェックが `main-ruleset.json` と同じになったことを確かめる。

### 必須のチェックの job 名を変えるとき

必須のチェックの名前は、job の表示名で決まる。表示名は `jobs.<job_id>.name` があればその値、なければ job ID（今は `ci`・`e2e`・`pr-title`）になる。workflow の job ID や `name:` だけを変えると、その名前のチェックがいつまでも来ないので、どの PR もマージできなくなる。job 名を変えるときは、同じ PR で次の両方を行う。

1. ルールセットの必須のチェックの名前を、新しい job 名に変える
2. `main-ruleset.json` の `context` も同じ名前にする

`main-ruleset.json` の名前が `.github/workflows/` のどの job の表示名とも合わないとき、2つの workflow の job が同じ名前のとき、その workflow が main への PR と push の両方で動かないときは、`tools/docs-check` のテストが落ちる。テストは名前を決め打ちしていないので、テストを直す必要はない。

## CI が壊れて直せないとき

bypass がないので、CI が通らないと、CI を直す PR もマージできない。GitHub Actions の障害などで、どうしても通せないときだけ、ルールセットを一時的に止める。

```sh
# 止める
gh api -X PUT repos/XeicuLy/zubatto-quiz/rulesets/<id> -f enforcement=disabled
# PR をマージしたら、すぐに戻す
gh api -X PUT repos/XeicuLy/zubatto-quiz/rulesets/<id> -f enforcement=active
```

- 止めている間は、force push や main の削除も防げない。マージが終わったらすぐに戻す
- 戻したら、`gh api repos/XeicuLy/zubatto-quiz/rulesets/<id> --jq .enforcement` が `active` になっていることを確かめる

## v\* のタグのルールセット

`v*` のタグは、本番への入口になる。production の Environment は `v*` のタグからのデプロイを許しているので（[deploy.md](deploy.md#github-の-environmentproductionを作る)）、誰でもタグを打てると、好きなコミットに `v*` を打ち、そのタグの上で deploy.yaml を動かして本番に出せてしまう。タグを作れるのを App だけにすれば、タグは「リリース PR をマージした」ときにしかできない（ADR 0010）。

### タグのルールセットで決めていること

| 項目                     | 値                                                    | なぜ                                                                                                         |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 対象                     | `refs/tags/v*`                                        | 版のタグだけを守る。`*` は `/` をまたがない                                                                  |
| 作成の禁止（`creation`） | あり                                                  | 人が好きなコミットに `v*` を打てないようにする                                                               |
| 更新の禁止（`update`）   | あり                                                  | 今あるタグを別のコミットへ付け直せないようにする。付け直すと、同じ版の名前で別のコードが本番に出る           |
| 削除の禁止（`deletion`） | あり                                                  | 消してから同じ名前で打ち直す道もふさぐ                                                                       |
| bypass                   | release-please の App だけ（`Integration`・`always`） | App はリリース PR のマージで Release を作り、そのときタグも作る。bypass したことは監査ログに残る（`always`） |

- `actor_id` は App の **App ID**（数字）。Client ID（`Iv` で始まる文字列）ではない。App ID は App の設定画面（`https://github.com/settings/apps/<App の名前>`）の About に出る。非公開の App なので、`gh api apps/<App の名前>` では読めない
- 作る前からある `v1.0.0` などのタグは、そのまま残る。作ったあとは、それらも動かせず消せなくなる

### タグのルールセットを作る

リポジトリを作り直したときや、App を作り直したとき（App ID が変わる）は、先に `release-tag-ruleset.json` の `actor_id` を新しい App ID にしてから作る。production に `v*` を許す（[deploy.md](deploy.md#github-の-environmentproductionを作る)）より**前に**作る。逆の順だと、その間は誰でもタグを打って本番に出せる。

```sh
gh api -X POST repos/XeicuLy/zubatto-quiz/rulesets --input docs/runbooks/release-tag-ruleset.json
```

作ったら、名前・対象・ルール・bypass を確かめる。`id` は、下の止め方でも使う。

```sh
gh api repos/XeicuLy/zubatto-quiz/rulesets --jq '.[] | select(.name == "release-tags") | .id'
gh api repos/XeicuLy/zubatto-quiz/rulesets/<id> \
  --jq '{enforcement, target, include: .conditions.ref_name.include, rules: [.rules[].type], bypass: [.bypass_actors[] | {actor_id, actor_type, bypass_mode}]}'
```

`enforcement` が `active`、`target` が `tag`、`include` が `["refs/tags/v*"]`、`rules` が `creation`・`update`・`deletion`、`bypass` が App ID の `Integration` 1つだけになっていればよい。設定を画面やコマンドで変えたときは、main のルールセットと同じく（[上の「設定を変える」](#設定を変える)）、`release-tag-ruleset.json` もそろえる。

- `update` のルールには `parameters` を付けない。API のドキュメントでは `update_allows_fetch_and_merge` が必須と書かれているが、タグのルールセットでは付けても受け付けたうえで捨てられ、書き出した設定と合わなくなる（2026-10-28 に作って確かめた）
- `tools/docs-check` のテストは、対象が `v*` のタグだけであること、3つの禁止がそろっていること（`parameters` がないことも）、bypass が App 1つだけであること、GitHub が付ける項目を含まないことを確かめる。App ID の値そのものは確かめないので、作り直したときは自分で見比べる
- App ID が違っていると、リリース PR をマージしても release-please がタグを作れず、Release もできない（[release.md の「失敗したとき」](release.md#失敗したとき)）

### 打ち間違えたタグを消す

bypass は App だけなので、admin でも `v*` のタグを消せない。release-please が違う版のタグを作ったときなど、どうしても消すときだけ、ルールセットを一時的に止める。

```sh
# 止める
gh api -X PUT repos/XeicuLy/zubatto-quiz/rulesets/<id> -f enforcement=disabled
# Release とタグを消す
gh release delete <タグ> --cleanup-tag --yes
# すぐに戻す
gh api -X PUT repos/XeicuLy/zubatto-quiz/rulesets/<id> -f enforcement=active
```

- 止めている間は、誰でも `v*` のタグを打てる。production は `v*` のタグからのデプロイを許しているので、止めている間は本番への入口が開いている。消したらすぐに戻す
- 戻したら、`gh api repos/XeicuLy/zubatto-quiz/rulesets/<id> --jq .enforcement` が `active` になっていることを確かめる
