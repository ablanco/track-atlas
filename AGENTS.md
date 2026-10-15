# Development workflow

- Until the first release, work directly on `master`; do not create feature branches or worktrees unless explicitly requested.

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
