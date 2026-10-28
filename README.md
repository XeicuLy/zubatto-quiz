# ズバッとクイズ

ズバッとクイズ（ズバクイ）は、正解したかどうかに加えて、答えた速さも点数にするリアルタイムの4択クイズ。ホストが部屋を作って URL を共有し、回答者はスマホからログインなしで参加する。

Cloudflare の無料プランの上で、TypeScript だけで動く。画面の Worker（`apps/web`）と、API と部屋の Durable Object の Worker（`apps/api`）の2つに分かれている。

## 文書

| 場所                                                                   | 中身                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| [docs/requirements/zubatto-quiz.md](docs/requirements/zubatto-quiz.md) | 要件定義書。要件の ID（`F*`・`P*`・`S*` など）はここで決める |
| [docs/adr/](docs/adr/)                                                 | 技術の判断の記録（ADR）                                      |
| [docs/design/](docs/design/README.md)                                  | 画面のデザインモック                                         |
| [docs/runbooks/](#運用の手順書)                                        | コードで表せないものの手順書                                 |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                     | コントリビュートの方針と進め方                               |

## 開発環境を作る

前もって [mise](https://mise.jdx.dev/) と git を入れておく。node と pnpm の版は `.mise.toml` で決まっているので、mise が入れる。

1. 依存を入れる

   ```sh
   make setup
   ```

2. ローカル用の GitHub OAuth App を作る（[github-oauth-apps.md](docs/runbooks/github-oauth-apps.md)）
3. `apps/api/.dev.vars.example` を `apps/api/.dev.vars` に写し、空の値を埋める（[secrets.md](docs/runbooks/secrets.md#ローカル-appsapidevvars)）
4. ローカルの D1 にマイグレーションを当てる

   ```sh
   pnpm --filter @zubatto-quiz/api run db:migrate:local
   ```

5. ローカルの D1 の許可リストに、自分の GitHub のユーザー ID を入れる（[host-allowlist.md](docs/runbooks/host-allowlist.md)。`--local --persist-to ../web/.wrangler/state` を付ける）
6. 開発用のサーバーを動かし、`http://localhost:5173` を開く

   ```sh
   pnpm --filter @zubatto-quiz/web run dev
   ```

   `vite dev` 1つで、画面の Worker と API の Worker（部屋の DO と D1 を含む）がローカルの Workers の実行環境で動く（ADR 0006）。API の Worker だけを `wrangler dev` で動かすことはしない。ブラウザからは画面の Worker の `/api/*` を通して呼ぶ作りなので、ログインや `Origin` の確認が合わなくなる

7. `http://localhost:5173/login` から GitHub でログインできることを確かめる

### よく使うコマンド

```sh
make check          # CI と同じ確認（整形・lint・型チェック・テスト）をまとめて走らせる
make e2e            # 通しの E2E（Playwright）。ホストのログインから最終ランキングまで
pnpm run fmt        # 整形する
pnpm run test       # すべてのテスト
pnpm exec vitest run --project <名前>   # 1つのパッケージのテスト（api・api-bundle・web・protocol・scoring・loadtest・docs など）
```

- E2E を初めて走らせる前に、`pnpm exec playwright install chromium` でブラウザを入れる。E2E は本番と同じビルドを `vite preview`（`http://localhost:4173`）で動かすので、CSP の `_headers` も効く。ログインは GitHub を通らず、テスト専用の API の入口（`apps/api/test/e2e-entry.ts`、`wrangler.jsonc` の `env.e2e`）で行う。本番のデプロイには入らない（ADR 0003）
- E2E の D1 と DO は `apps/web/.wrangler/e2e` に置き、走らせるたびに空から始める。`vite dev` のデータ（`.wrangler/state`）には触れない

- テストは `.dev.vars` も Cloudflare のアカウントも要らない。D1 と DO は、ローカルの Workers の実行環境で動く
- D1 のスキーマを変えたら `pnpm --filter @zubatto-quiz/api run db:generate --name <名前>` でマイグレーションを作り、`db:migrate:local` で当て直す

## 本番の環境を一から作る

次の順に行う。初めて作るときも、作り直すときも同じ。

1. Cloudflare のアカウント（Workers Free）を用意し、`apps/api` で `pnpm exec wrangler login` する
2. 本番の D1 を作る（ADR 0005）

   ```sh
   cd apps/api
   pnpm exec wrangler d1 create zubakui --location apac --update-config=false
   ```

   - `--update-config=false` で、D1 を `wrangler.jsonc` に足さない。D1 の ID はリポジトリに入れない。wrangler は名前（`zubakui`）で D1 を探す。付けないと「Would you like Wrangler to add it on your behalf?」と聞かれ、既定が yes なので、Enter だけで ID が書き込まれる（wrangler 4.149.0 で 2026-10-18 に確かめた）
   - `--location apac` を付けないと、コマンドを実行した場所の近くに置かれる。あとから場所は変えられない。都市は選べず、地域だけを選べる。置かれた地域は `pnpm exec wrangler d1 info zubakui` の `running_in_region` で確かめる

3. 本番用の GitHub OAuth App を作る（[github-oauth-apps.md](docs/runbooks/github-oauth-apps.md)）
4. API の Worker にシークレットを入れる（[secrets.md](docs/runbooks/secrets.md#本番-wrangler-secret-put)）。初めてのときは、ここで空の API の Worker ができる
5. Cloudflare の API トークンを作り、アカウント ID とあわせて GitHub の Environment（`production`）の secret に入れ、Required reviewers に自分を足す（[deploy.md](docs/runbooks/deploy.md#はじめに一度だけ用意するもの)）
6. GitHub Actions のデプロイの workflow を「API と画面」（`all`）で動かす（[deploy.md](docs/runbooks/deploy.md#動かす)）。マイグレーション → API の Worker → 画面の Worker の順に行われる。手元からはデプロイしない（ADR 0005）
7. 本番の D1 の許可リストに自分を入れる（[host-allowlist.md](docs/runbooks/host-allowlist.md)）
8. 本番の URL の `/login` から GitHub でログインし、最終ランキングまで通せることを確かめる（[deploy.md](docs/runbooks/deploy.md#デプロイのあとに確かめる)）
9. リポジトリを作り直したときは、main のルールセットも作り直す（[branch-protection.md](docs/runbooks/branch-protection.md)）。`v*` のタグのルールセットは、App ID が要るので 10 で作る
10. リポジトリを作り直したときは、リリースの GitHub App と Environment `release`、squash だけのマージの設定、`v*` のタグのルールセットも用意し直す（[release.md](docs/runbooks/release.md#はじめに一度だけ用意するもの)）。production に `v*` のタグを許すのは、タグのルールセットを作ったあと

本番の最中は、API の Worker をデプロイしない。部屋の WebSocket がすべて切れる（ADR 0006）。画面だけを直すときは、workflow を「画面だけ」（`web`）で動かす。

## 運用の手順書

| 手順書                                                     | いつ使うか                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| [github-oauth-apps.md](docs/runbooks/github-oauth-apps.md) | GitHub OAuth App を作る・Client Secret を作り直す                 |
| [secrets.md](docs/runbooks/secrets.md)                     | `.dev.vars` を書く・本番のシークレットを入れる・変える            |
| [deploy.md](docs/runbooks/deploy.md)                       | 本番にデプロイする・API トークンを入れる・作り直す                |
| [host-allowlist.md](docs/runbooks/host-allowlist.md)       | ホストを足す・外す（取り消す）                                    |
| [stop-and-usage.md](docs/runbooks/stop-and-usage.md)       | 本番の前後に使用量を確かめる・すぐに止める                        |
| [logs.md](docs/runbooks/logs.md)                           | 本番中と本番のあとにエラーのログを見る・手元に残す（O1）          |
| [branch-protection.md](docs/runbooks/branch-protection.md) | main と `v*` のタグのルールセットを見る・作り直す・一時的に止める |
| [release.md](docs/runbooks/release.md)                     | リリース PR から版を出す・GitHub App を作る・鍵を入れ替える       |
| [tools/loadtest/README.md](tools/loadtest/README.md)       | 本番の前に、ボットで同時参加を再現してリハーサルする（O2）        |

## コントリビュート

コントリビュートは、開発者の知り合いからだけ受け付ける（M3）。進め方は [CONTRIBUTING.md](CONTRIBUTING.md) にある。
