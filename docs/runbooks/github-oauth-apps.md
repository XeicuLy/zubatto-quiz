# GitHub OAuth App

ホストは GitHub のアカウントでログインする（ADR 0003）。GitHub から戻ってくる先（コールバック URL）が環境ごとに違うので、OAuth App をローカル用と本番用の2つ作る。

## 入れる値

| 項目                       | ローカル用                                       | 本番用                                     |
| -------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Application name           | `ズバクイ (local)` など                          | `ズバクイ` など                            |
| Homepage URL               | `http://localhost:5173`                          | 画面の Worker の URL（下の「本番の URL」） |
| Authorization callback URL | `http://localhost:5173/api/auth/callback/github` | `<本番の URL>/api/auth/callback/github`    |
| Enable Device Flow         | 付けない                                         | 付けない                                   |

- コールバック URL は `BETTER_AUTH_URL` + `/api/auth/callback/github` になる。`BETTER_AUTH_URL` は API の Worker ではなく、ブラウザから見える画面の Worker の URL にする（ADR 0006）
- `http://localhost:5173` は `vite dev` の既定の URL。ポートを変えたときは、OAuth App と `.dev.vars` の `BETTER_AUTH_URL` も合わせる

### 本番の URL

本番の画面の Worker は `zubakui-web` という名前で workers.dev に出す。URL は次の形になる。

```text
https://zubakui-web.<サブドメイン>.workers.dev
```

`<サブドメイン>` は Cloudflare のアカウントごとに決まっている。ダッシュボードの Workers & Pages に表示される `<サブドメイン>.workers.dev` で確かめる。画面の Worker をまだデプロイしていなくても、URL は先に決まる。

## 作る

1. GitHub の Settings → Developer settings → OAuth Apps → New OAuth App を開く
2. 上の表の値を入れて Register application を押す
3. 表示された Client ID を控える。`Ov23li` で始まる文字列で、設定ページの URL に入っている数字ではない
4. Generate a new client secret を押し、表示された Client Secret を控える。Client Secret は、このときしか表示されない
5. 控えた2つを入れる
   - ローカル用: `apps/api/.dev.vars` の `GITHUB_CLIENT_ID` と `GITHUB_CLIENT_SECRET`（[secrets.md](secrets.md)）
   - 本番用: `wrangler secret put GITHUB_CLIENT_ID` と `wrangler secret put GITHUB_CLIENT_SECRET`（[secrets.md](secrets.md)）

Client ID と Client Secret は、チャットやリポジトリに貼らない。

## 確かめる

- ローカル: `vite dev` を動かし、`http://localhost:5173/login` から GitHub でログインする。許可リストに自分を入れていないと `host_not_allowed` で戻される（[host-allowlist.md](host-allowlist.md)）。入れていれば管理画面（`/admin`）に入れる
- 本番: デプロイのあとに、本番の URL の `/login` から同じようにログインする

GitHub の画面で「redirect_uri is not associated with this application」と出たら、OAuth App のコールバック URL と `BETTER_AUTH_URL` が合っていない。

## Client Secret を作り直す

漏れたかもしれないときは、作り直す。

1. OAuth App の画面で Generate a new client secret を押し、新しい Client Secret を入れる（ローカルは `.dev.vars`、本番は `wrangler secret put GITHUB_CLIENT_SECRET`）
2. 新しい値でログインできることを確かめてから、古い Client Secret を Delete する

ログインしているホストのセッションは、Client Secret を変えても切れない。GitHub に問い合わせるのはログインするときだけだから。
