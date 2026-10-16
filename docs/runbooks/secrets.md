# シークレット

API の Worker（`apps/api`）は、次の4つの値で動く。名前は `apps/api/wrangler.jsonc` の `secrets.required` に書いてあり、値はリポジトリに入れない（ADR 0005）。

| 名前                   | 中身                                                        | ローカルの値                | 本番の値                                                                                                    |
| ---------------------- | ----------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_URL`      | ブラウザから見える画面の Worker の URL                      | `http://localhost:5173`     | `https://zubakui-web.<サブドメイン>.workers.dev`（[github-oauth-apps.md](github-oauth-apps.md#本番の-url)） |
| `BETTER_AUTH_SECRET`   | ログイン Cookie の署名と、GitHub のトークンの暗号化に使う鍵 | 自分で作る（下）            | 自分で作る（下）。ローカルとは別の値にする                                                                  |
| `GITHUB_CLIENT_ID`     | GitHub OAuth App の Client ID                               | ローカル用の OAuth App の値 | 本番用の OAuth App の値                                                                                     |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App の Client Secret                           | ローカル用の OAuth App の値 | 本番用の OAuth App の値                                                                                     |

- `BETTER_AUTH_URL` は秘密の値ではないが、`vars` ではなくシークレットにしている。`vars` は、デプロイのたびに `wrangler.jsonc` に書いた値へ戻る。本番の値を入れ忘れても localhost のまま動き、GitHub から戻る先が localhost になってしまう。シークレットにしておけば、入れ忘れたときにデプロイが「Missing required secrets」で止まる
- `BETTER_AUTH_URL` が `https://` で始まるかで、Cookie に `Secure` が付くかと、名前の先頭に `__Secure-` が付くかが決まる（ADR 0003）
- テスト（vitest）は `apps/api/vitest.config.ts` のテスト用の値で動くので、`.dev.vars` は要らない

## BETTER_AUTH_SECRET を作る

32バイトのランダムな値を作る。

```sh
openssl rand -base64 32
```

## ローカル: apps/api/.dev.vars

ひな形の [apps/api/.dev.vars.example](../../apps/api/.dev.vars.example) を写し、空の3つを埋める。`BETTER_AUTH_URL` は `http://localhost:5173` が入っている。

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

- `.dev.vars` は `.gitignore` に入っている。`.dev.vars.example` だけは名前のひな形としてコミットするので、本物の値を書かない。値が入っていると `tools/docs-check` のテストが落ちる
- `.dev.vars` があると、wrangler はそこからだけ値を探す。1つでも欠けていると `vite dev` でログインできない
- `wrangler.jsonc` の `secrets.required` に名前を足したら、`.dev.vars.example` にも足す。そろっていないと `tools/docs-check` のテストが落ちる

## 本番: wrangler secret put

Cloudflare のアカウントにログインしてから（`pnpm exec wrangler login`）、`apps/api` で1つずつ入れる。値は聞かれてから貼る。コマンドの引数に値を書くと、シェルの履歴に残る。

```sh
cd apps/api
pnpm exec wrangler secret put BETTER_AUTH_URL
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put GITHUB_CLIENT_ID
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
```

- 入れたら、名前だけを確かめる。値は表示されない

  ```sh
  pnpm exec wrangler secret list
  ```

- 画面の Worker（`apps/web`）にはシークレットがない

### はじめて入れるとき

本番の API の Worker（`zubakui-api`）がまだないときは、「There doesn't seem to be a Worker called "zubakui-api". Do you want to create a new Worker with that name and add secrets to it?」と聞かれる。`y` と答えると、何もしない空の Worker が作られ、そこにシークレットが入る。

この順番にしているのは、`secrets.required` のある Worker を初めてデプロイするとき、シークレットが入っていないと wrangler が「This Worker does not exist yet」というエラーで止まるため。先に `wrangler secret put` で Worker を作っておけば、デプロイはその Worker を中身ごと置き換え、シークレットは引き継がれる。デプロイの workflow に `--secrets-file` を渡さずに済むので、アプリのシークレットを GitHub Actions に置かなくてよい（ADR 0005）。wrangler 4.149.0 のソースで、2026-10-17 に確かめた。

Worker を消すと（[stop-and-usage.md](stop-and-usage.md)）、シークレットも一緒に消える。また動かすときは、ここからやり直す。

## 値を変える

同じ `wrangler secret put <名前>` で上書きする。すぐに新しい値で動く。

- `BETTER_AUTH_SECRET` を変えると、ログイン Cookie の署名が合わなくなり、すべてのホストがログインし直しになる。D1 に暗号化して保存した GitHub のトークンも読めなくなるが、アプリでは使っていないので困らない
- `GITHUB_CLIENT_SECRET` の作り直しは [github-oauth-apps.md](github-oauth-apps.md#client-secret-を作り直す)
- 本番の最中に変えない。ホストがログインし直しになることがある
