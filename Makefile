.PHONY: setup fmt lint tsc test check e2e

setup:
	mise install
	mise exec -- pnpm install --frozen-lockfile

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
