# team-dashboard — Repo Rules

- TDD: failing test first for any package code (Tasks 4-6 of build-brief).
- No commits to `main` directly after the initial scaffold. Feature branch → PR → review → squash merge.
- Secrets live in `.env.local` (gitignored) for dev, GitHub repo secrets for cron.
- NEVER commit a file containing `SUPABASE_SERVICE_ROLE_KEY=` or `OPENAI_API_KEY=`.
- Spec is in utopia-docs wiki/products/team-dashboard/. Decisions are in adr/.

When in doubt: read the spec, then ADRs, then ask Boss.
