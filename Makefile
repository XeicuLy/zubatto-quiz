.PHONY: setup

setup:
	mise install
	mise exec -- pnpm install --frozen-lockfile
