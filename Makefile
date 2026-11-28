.PHONY: setup dev fmt lint tsc test check e2e

# Workers の型（worker-configuration.d.ts）はリポジトリに入れないので、エディタが読めるようここで作る
setup:
	mise install
	mise exec -- pnpm install --frozen-lockfile
	mise exec -- pnpm -r --if-present run types

# 開発用のサーバー（vite dev、http://localhost:5173）。ローカルの D1 にマイグレーションを当ててから動かす。
# 当て済みのマイグレーションは飛ばすので、毎回当てても変わらない。.dev.vars が無いとログインできないので、先に止める
dev:
	@test -f apps/api/.dev.vars || { echo 'apps/api/.dev.vars が無い。README の「開発環境を作る」の手順3で作る' >&2; exit 1; }
	mise exec -- pnpm --filter @zubatto-quiz/api run db:migrate:local
	mise exec -- pnpm --filter @zubatto-quiz/web run dev

fmt:
	mise exec -- pnpm run fmt

lint:
	mise exec -- pnpm run lint

tsc:
	mise exec -- pnpm run tsc

test:
	mise exec -- pnpm run test

# E2E（Playwright）。初めてのときは pnpm exec playwright install chromium でブラウザを入れる
e2e:
	mise exec -- pnpm run e2e

# CI と同じ確認をまとめて走らせる（E2E は別に make e2e で走らせる）
check:
	mise exec -- pnpm run fmt:check
	mise exec -- pnpm run lint
	mise exec -- pnpm run tsc
	mise exec -- pnpm run test
