# Changelog

All notable user-facing or builder-facing changes per merged PR. One entry per PR, newest first. Tone matches ADR 015 (Boss-readable, plain English, no tooling jargon in the body of an entry).

## 2026-05-12 — Layer B: AI weekly digest (PR #20)

Every Monday morning the dashboard now shows one short paragraph per developer summarising the previous Mon-to-Sun week. Each entry has a momentum badge (accelerating / steady / slowing / stalled / no_activity) and 3-5 short business-language tags. New `/week` route lists everyone ranked by momentum; the per-developer page gains a "This Week" section above the heat-map; the home page gets a "This week →" link. The first weekly cron will fire on the Boss-side `claude` CLI install in CI, scheduled `30 23 * * 0` UTC = 07:30 KL Monday. ADR 015 tone rules apply with a 100-180 word budget. See [build-brief](https://github.com/charlieutopia/team-dashboard/pull/20) and ADR 016 once filed.

## 2026-05-12 — Boss-readable prompt rewrite (PR #19)

The daily summaries are now first-name + bottom-line-up-front + plain English, capped at 60-100 words. The 17 tooling words banned in the body (`diff`, `commit`, `branch`, `module`, ...) are translated to what they do for the business. Decision lives in [ADR 015](wiki/products/team-dashboard/adr/015-boss-readable-summary-tone.md) in utopia-docs. New `pnpm scanner:probe-tone <handle>` tool for iterating tone without overwriting production data.

## 2026-05-12 — Layer A: per-developer drill-down (PR #18)

New `/dev/[handle]` route with a 30-day trajectory heat-map, daily timeline cards, and totals (commits, lines, files, on-track ratio, advancing/drifting counts). Tap any developer card on the home page to drill in.

## 2026-05-11 — Latest-available-date fallback (PR #17)

The home page used to require today's report data to render — when today's cron hadn't fired yet, the page was blank. Now it falls back to the most recent date with data and shows a stale-date banner when that's not today. Also handles parse-failed rows gracefully.

## 2026-05-11 — Email + password login (PR #16)

Replaces the originally-planned GitHub OAuth login (which never worked — Supabase had the GitHub provider disabled the whole time). The Boss now signs in with her email and the password an admin set via Supabase Admin API. Signup is disabled; only seeded developers can log in.

## 2026-05-10 — Phase 2.A: pivot to Claude Code Max (PR #15)

The analyzer no longer uses OpenAI Batch + GPT-4o. It now invokes Claude Code headlessly, per developer per day. Marginal cost drops from a projected $60-90/month to $0 (consumes existing Max subscription quota). Same JSON contract on the output side, so downstream code didn't change. Decision lives in [ADR 013](wiki/products/team-dashboard/adr/013-pivot-from-openai-batch-to-claude-code-max.md); cron-timing follow-up in [ADR 014](wiki/products/team-dashboard/adr/014-cron-timing-synchronous-cc.md).
