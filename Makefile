.PHONY: setup fmt

setup:
	mise install
	mise exec -- pnpm install --frozen-lockfile

fmt:
	mise exec -- pnpm run fmt
