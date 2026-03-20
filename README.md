# Wonderly Ads Manager

Meta (Facebook) ad management dashboard with a Slack bot and AI-powered automation rules. Deployed on Vercel.

**Production:** wonderly-ads-manager.vercel.app

## Stack

- **Next.js 16** (App Router, React 19) — hosted on Vercel
- **Meta Marketing API v21.0** — all ad data and mutations
- **Claude (Anthropic)** — AI chat and Slack bot analysis
- **Slack API** — bot for natural-language ad management
- **Redis** — automation rules persistence for cron jobs
- **Tailwind CSS 4 + Radix UI** — UI components

## Local development

```bash
npm install
cp .env.example .env.local  # fill in your values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `USE_MOCK_DATA=true` in `.env.local` to skip Meta API calls during development.

## Scripts

```bash
npm run dev          # development server
npm run build        # production build
npm run typecheck    # TypeScript check (no emit)
npm test             # Vitest unit tests
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check (used in CI)
npm run validate     # typecheck + lint + format:check
```

## Deployment

Push to `main` → Vercel auto-deploys. No manual steps.

All secrets live in Vercel → Settings → Environment Variables. See [`.env.example`](.env.example) for the full variable list with descriptions.

## Commit conventions

Commits are enforced by commitlint. Format: `<type>(<scope>): <Subject sentence-case>`

| Part        | Rule                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| **type**    | lowercase; one of: `build` `chore` `ci` `docs` `feat` `fix` `perf` `refactor` `revert` `style` `test`                |
| **scope**   | optional, lowercase — area changed: `ui`, `api`, `auth`, `meta`, `slack`, `automations`, `chat`, `dashboard`, `deps` |
| **subject** | sentence-case (first word capitalised). Max header length: 120 chars                                                 |

```
feat(ui): Add dark/light theme toggle
fix(auth): Return 401 when session cookie is missing
chore(deps): Upgrade next to 16.2.0
```

## Docs

- [`CLAUDE.md`](./CLAUDE.md) — architecture, conventions, security rules, known issues (read this first)
- [`docs/slack.md`](./docs/slack.md) — Slack bot setup and usage
- [`docs/issues-plan.md`](./docs/issues-plan.md) — prioritized fix plan for known security and quality gaps
