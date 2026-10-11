# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

ズバッとクイズ (ズバクイ) is a real-time multiple-choice quiz app where players score on both correctness and answer speed. The repo is **pre-implementation**: it holds tooling, CI and design documents. The pnpm workspace (`apps/*`, `packages/*`, `tools/*`) is set up. The packages so far are `packages/protocol` (the WebSocket message spec) and `packages/scoring` (score and ranking calculation); no application code or `wrangler.jsonc` exists yet. Before you design or implement anything, read the documents below. They are the source of truth:

- `docs/requirements/zubatto-quiz.md` is the requirements spec. Requirement IDs are `F*` (functional), `P*` (performance), `S*` (security), `A*` (availability), `SC*` (scalability), `M*` (maintainability), `C*` (cost) and `O*` (operations). ADRs and commits cite these IDs.
- `docs/adr/0001`–`0005` record the accepted architecture decisions. Each ADR's "対応事項" list under Consequences is effectively the implementation checklist.
- `plan.md` holds the original rough idea, including the frontend stack: React + TanStack Start as an SPA with `ssr: false`, TanStack Query, and zustand if needed. Where it conflicts with the requirements or ADRs, those win. `memo.md` is a gitignored scratch file.

## Commands

```sh
make setup          # mise install (node/pnpm/uv pinned in .mise.toml) + pnpm install --frozen-lockfile
make check          # everything CI runs: fmt:check, lint, tsc, test
pnpm run fmt        # oxfmt (printWidth 120, single quotes, sorted imports/Tailwind classes/package.json)
pnpm run fmt:check
pnpm run lint       # oxlint --deny-warnings over the whole repo (.oxlintrc.json)
pnpm run tsc        # root tsc --noEmit, then each package's own `tsc` script
pnpm run test       # vitest run; root vitest.config.ts bundles apps/*, packages/* and tools/* as projects
pnpm exec vitest run --project <name>   # one package; the project name is its vitest config `name`, else its package.json `name`, else its directory name
```

- A Claude Code PostToolUse hook runs `oxfmt` on every file after Edit/Write, so don't format by hand.
- `.npmrc` sets `save-exact=true`, so dependencies are pinned to exact versions.
- CI (`.github/workflows/ci.yaml`) runs the same four checks on every PR to `main`. The `main` repository ruleset requires the `ci` job (GitHub Actions only) and has no bypass actors, so not even admins can merge a failing PR. Keep that job name.
- Each package's `tsconfig.json` extends `tsconfig.base.json` and adds its own `types`/`lib`. A package with a `tsc` script is type-checked by the root `pnpm run tsc`.
- vitest 4 fails with "No projects were found" when no project glob matches, so `vitest.config.ts` leaves `projects` unset while `apps/`, `packages/` and `tools/` are empty. Stay on vitest 4.x until `@cloudflare/vitest-pool-workers` supports 5.
- oxlint rejects `dangerouslySetInnerHTML`, `innerHTML`-style DOM APIs (ADR 0004) and imports of test code (`test/`, `*.test.*`, `*.spec.*`) from production code. Test code may import production code.

## Commits

- Commitlint enforces Conventional Commits through a husky `commit-msg` hook. The type is in English and the subject is in plain-form Japanese, for example `docs: 1部屋の WebSocket 接続に100本の上限を設ける`.
- Don't mention the target event or its deadline in commit messages.
- `.claude/settings.json` denies `git reset`, `git rebase` and `git rm`.

## Planned architecture (from the ADRs)

The first release is all TypeScript on Cloudflare's free plan. After the first event, the backend will be rewritten in Go on Cloud Run with Terraform (ADR 0001). Keep backend platform specifics out of anything the frontend depends on. In particular, the **WebSocket JSON message spec must be platform-independent and shared between frontend and backend**, so the rewrite doesn't touch the frontend.

- **Runtime**: a Hono Worker plus **one Durable Object per room**. The DO uses the WebSocket Hibernation API and DO SQLite, and it is the single source of truth for room state, scores and answers. There is no polling or SSE.
- **Worker layout** (ADR 0006): two Workers. `apps/web` serves the SPA as static assets and forwards `/api/*` to `apps/api` (Hono + DO + Better Auth) over a Service binding, so the browser sees one origin. No CORS and no `crossSubDomainCookies`. Every API and WebSocket path lives under `/api/`. `apps/api` sets `workers_dev: false` and `preview_urls: false`. Don't deploy `apps/api` during an event, because that drops the room WebSockets.
- **Question sets** (ADR 0002) are stored in D1 and scoped by `owner_id`. Every D1 access layer takes `owner_id` as a required argument. Room creation reads the whole set from D1 once and writes it into the room DO's SQLite in a single transaction. During play, the room never reads D1 again. Correct answers never leave the DO before the deadline (S2).
- **Host auth** (ADR 0003): Better Auth with GitHub login. An allowlist of GitHub user IDs is checked in `databaseHooks` on both sign-up and session creation, and `owner_id` is Better Auth's `user.id`.
  - The host WebSocket entry checks `Origin`, resolves `ownerId` from the cookie session and passes it to the DO.
  - The DO records the attachment `{ role: "host", ownerId }` only when that ID owns the room.
  - Progression commands are accepted only from host-role connections.
- **Players** (ADR 0004) use a separate entry that never reads cookies.
  - The client generates a 32-byte secret, stores it in localStorage per room, and sends `join { name, token }` or `resume { token }` as the first WS message. The secret is never put in a URL or a log.
  - The DO stores only a SHA-256 hash and compares hashes with `timingSafeEqual`.
  - A `null` attachment means the connection is unverified. Unverified connections may send only `join` or `resume`.
  - `participantId` always comes from the attachment, never from the message body.
  - A new connection for the same participant closes the old one, and the old tab does not auto-reconnect.
- **Concurrency invariants**:
  - Count `getWebSockets()` against the 100-connection cap before `acceptWebSocket`, with no `await` in between.
  - Run the `join` checks (name collision after NFKC normalization and trim, 50-player cap) and the insert as synchronous SQL with no `await`.
  - Enforce one answer per question with `UNIQUE(question_id, participant_id)` and an accepting-answers check in one transaction.
- **XSS hardening** replaces HttpOnly here:
  - CSP `script-src 'self'`.
  - Markdown (F5) renders no raw HTML.
  - Never use `innerHTML`-style APIs for user-provided names.
- **Infra** (ADR 0005): `wrangler.jsonc` is the only IaC. It holds the Worker, the DO `new_sqlite_classes` migration and the D1 binding.
  - Secrets go in with `wrangler secret put`.
  - Anything that can't be expressed in config goes in README runbooks: the GitHub OAuth Apps for local and prod, the allowlist, and the stop procedure (delete the Worker).
  - No Terraform until the Go migration.
- **Scoring** (`packages/scoring`): pure functions for F11, F14 and F15. The room DO stores and broadcasts results; it never computes points or ranks itself.
  - Change point values only in `config.ts` (M2). F12's `quickBonus` goes into `defaultScoring` when the bonus is built.
  - Normalize each elapsed time once with `normalizeElapsedMs`, and use that value for display, points, the bonus and the fastest answers (P2).
  - Tie-break rules are in the requirements' 「同点のとき」 section. `positionOf` returns the protocol's `playerPosition` shape without `rankUp` and `hidden`; the deadline aggregation adds those.
  - Like `packages/protocol`, `tsconfig.lib.json` checks non-test `src/` with no ambient types.
- **Testing**: `vitest-pool-workers`, so DOs and D1 run in the local Workers runtime. Use `evictDurableObject` for hibernation and restart cases.
  - Better Auth's `testUtils` plugin goes only in a test-only auth instance.
  - Never ship a test-login endpoint in the production entry, even one gated by a runtime env flag.
  - Each ADR's Consequences section lists the security and concurrency cases that must have automated tests.

## Writing docs and ADRs

- Docs are written in plain, jargon-light Japanese. Match the existing tone, for example "確かめる" rather than "検証する".
- ADRs use the MADR format at `docs/adr/NNNN-<slug>.md`. The title is the decision itself, and the sections are Status / Context / Decision Drivers / Considered Options / Decision Outcome / Consequences. They are usually authored with the `tech-adr:adr-writer` skill.
- Decision drivers are numbered `DD1`, `DD2`, and so on. ADR 0001 predates this and uses `D1`. Option IDs must not reuse requirement prefixes (`F`/`P`/`S`/`A`/`SC`/`M`/`C`/`O`).
- When a decision changes a requirement, update `docs/requirements/zubatto-quiz.md` in the same change. Past commits show this pattern.
- Check service limits, pricing and API behavior against current docs (context7 MCP first) and state the date checked. The ADRs depend heavily on free-tier numbers.
