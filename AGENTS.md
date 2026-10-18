# Development workflow

- Until the first release, work directly on `master`; do not create feature branches or worktrees unless explicitly requested.

## Project references and documentation

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the implemented architecture and
  module boundaries, and [README.md](README.md) for setup, operations, and checks.
- [docs/DESIGN.md](docs/DESIGN.md) describes the intended product, not implemented
  functionality. GPX storage, interactive maps, and track search remain planned.
- Update `ARCHITECTURE.md` alongside changes to runtime behavior, data models,
  security boundaries, or infrastructure. Update `README.md` when setup,
  configuration, commands, or operational requirements change. Keep this file
  focused on contributor rules rather than duplicating the architecture.

## CodeGraph

- CodeGraph MCP is available for code exploration, symbol search, relationship
  analysis, and task context. Verify findings against source files.
- Run `codegraph init` in each new worktree to initialize its local index.
- The CodeGraph daemon updates the index automatically; manual syncs are not
  needed.

## Application boundaries

- Keep database access, secrets, password hashing, session handling, and CAPTCHA
  verification server-side; use `getDb()` from `@/db` in application code.
- Keep request-specific authentication outside shared caches. With Cache
  Components enabled, use appropriate request-time/Suspense boundaries and read
  the installed Next.js guides before changing rendering behavior.
- Validate and allowlist input on the server. Never accept account privilege
  flags from signup or expose passwords/hashes through action state or public
  user responses.
- Verify and atomically consume ALTCHA proofs before password hashing. Do not
  replace PostgreSQL replay protection with a process-local cache or introduce
  verification bypasses for tests. Keep signing secrets private.
- Keep user-facing text in both `messages/en.json` and `messages/es.json`; use
  locale-aware navigation from `@/i18n/navigation`.
- Use shared semantic theme tokens. Preserve the `next-themes` hydration patch
  and verify its behavior when upgrading that package.

## Verification

- Run `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` for application
  changes, plus the relevant suites listed in `README.md`.
- Use only a development database for live DB/browser tests. Migrate it first;
  never run fixture creation or cleanup against production.
- Test authentication/CAPTCHA changes at unit, database, and browser levels,
  including rejection paths and real widget verification. Test localized UI in
  both languages and check theme/hydration behavior for shared UI changes.

## Database models

- Every application model must have automatic `createdAt` and `updatedAt` fields
  (SQL: `created_at` and `updated_at`), both non-null timezone-aware timestamps.
- Spread a fresh `auditColumns()` result from `db/columns.ts` into each table.
  Database defaults initialize both timestamps; do not depend on client clocks.
- In each new table's migration, attach a `BEFORE UPDATE FOR EACH ROW` trigger
  executing `public.set_updated_at()` (introduced in `0001_add-users.sql`). It
  sets modification time from the database for Drizzle and direct SQL updates.
  Drizzle's runtime-only `$onUpdate` is not a substitute for this trigger.
- Preserve applied migrations. Generate new migrations and review their SQL and
  metadata, including triggers that Drizzle Kit does not manage automatically.

## Icons

- Use [Phosphor Icons](https://phosphoricons.com/) for icons, including brand and social network logos.
- Use components from `@phosphor-icons/react` instead of downloading SVG files or using icon fonts or remote runtime requests.
- In Server Components, import individual icons from `@phosphor-icons/react/dist/ssr/<IconName>` (for example, `GithubLogoIcon` from `@phosphor-icons/react/dist/ssr/GithubLogo`). In Client Components, use `@phosphor-icons/react/dist/csr/<IconName>`. This avoids compiling the entire icon catalog during development.
- Prefer the regular weight for consistency and inherit the surrounding text color.
- Decorative icons next to text must be hidden from assistive technology; keep meaningful text labels on links and controls.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Ignore routine debugging and unverified changes. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Keep a qualifying candidate through the reporting pass even if you resolve or work around it. A successful fix changes the report outcome; it does not erase the friction that qualified it.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `node node_modules/next/dist/bin/next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->
