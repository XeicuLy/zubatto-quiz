.PHONY: setup fmt lint tsc test check

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

# CI と同じ確認をまとめて走らせる
check:
	mise exec -- pnpm run fmt:check
	mise exec -- pnpm run lint
	mise exec -- pnpm run tsc
	mise exec -- pnpm run test
