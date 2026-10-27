# コントリビュートについて

ズバクイへのコントリビュート（Issue・PR）は、**開発者の知り合いだけ**から受け付ける（M3）。不特定多数に向けた OSS としては運用しない。知り合いでない人からの Issue や PR は、読まずに閉じることがある。

## 進め方

1. 何を変えるかを Issue に書く。設計の判断が要るときは、先に ADR（`docs/adr/`）で決める
2. main からブランチを作る。名前は `feature/issues/<Issue の番号>` にする
3. 変える。開発環境の作り方は [README](README.md#開発環境を作る) にある
4. push の前に `make check` を通す。CI と同じ確認（整形・lint・型チェック・テスト）をまとめて走らせる。画面や部屋の流れを変えたら、`make e2e` も通す
5. main への PR を出す。題名は下の「PR の題名とコミットメッセージ」の形にし、本文に `closes #<Issue の番号>` を書く
6. CI の `ci`・`e2e`・`pr-title` が通ったら、squash でマージする。どれかが通らない PR は、誰もマージできない（[main のルールセット](docs/runbooks/branch-protection.md)）

## PR の題名とコミットメッセージ

どちらも Conventional Commits の形にする。コミットメッセージは `commit-msg` のフック（commitlint）が、PR の題名は CI の `pr-title` が、同じ設定で確かめる。

- type は英語、件名は日本語の言い切りの形で書く。例: `docs: 1部屋の WebSocket 接続に100本の上限を設ける`
- scope は付けない。変えた場所は件名に書く
- マージは squash だけなので、**PR の題名がそのまま main のコミット名になり、CHANGELOG の1行になる**（[release.md](docs/runbooks/release.md)）。PR の中のコミットは、レビューしやすいように分けてよい（コードと docs を分けるなど）
- CHANGELOG に出るのは `feat`（新機能）・`fix`（修正）・`perf`（性能）だけ。`docs`・`test`・`ci`・`chore`・`refactor` などは出ず、版の番号も上げない。PR の題名の type は、利用者から見て何が変わるかで選ぶ
- 前と互換のない変更は、type のあとに `!` を付ける（例: `feat!: 部屋の WebSocket のメッセージの形を変える`）。major の番号が上がる。squash の本文は空にしているので、本文の `BREAKING CHANGE:` では伝わらない

## 文書

- 要件定義書（`docs/requirements/`）・ADR・手順書は、やさしい日本語で書く。たとえば「検証する」より「確かめる」
- 決定が要件を変えるときは、同じ変更で要件定義書も直す
- 使っているサービスの上限・料金・API の動きを書くときは、今のドキュメントで確かめ、確かめた日付を書く
