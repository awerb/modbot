# Changelog

## demo-day-1 (May 14, 2026)

### Phase 2: facilitation depth

**New rules (R2, R3, R7, R8, R9, R10).** Heat scoring with rolling-5 average, sustained-heat pause-suggested alerts with Sonnet-drafted pause messages, steelman-missing alerts on disagreements without acknowledgement, repair detection (apologies, walk-backs, acknowledgements), exit-velocity alerts (contested + 48h silence), quiet-member-substantive surfacing, 7-day Q/A ratio.

**Schema additions.** `analyses` table gains `heat_score`, `is_disagreement`, `steelman_present`, `is_question`, `is_assertion`, `is_repair`, `repair_notes`, `references_member_id`. New tables `group_state`, `member_state`, `moderator_alerts`. Runtime migration on startup (`ALTER TABLE ADD COLUMN IF NOT EXISTS`).

**AI pipeline.** New `deep_analysis` Sonnet call that batches phase-2 classification into one prompt. New `pause_prompt` Sonnet drafter.

**UI.** Top strip on dashboard (heat gauge, Q/A ratio, repair count). Moderator alerts panel with kind-specific colors and copy-to-clipboard on pause-prompt drafts. Member tile badges (repair count ★, steelman count ⚖, exit-risk ⚠, exit-risk paints the tile border). Chat bubble icons (heat 🔥, repair ★, question ?, steelman-missing ⚠). Pause-suggested banner above chat. New top-bar tabs: **Demo** / **About + roadmap**. New `AboutTab` with stack, data model, rules wired in, roadmap, open questions, full endpoint reference.

**Content refresh.** Renamed Daniel Stern → Michael Standup. Rewrote Priya Anand as the Strident Voice (emotional, opposite Michael). New ~40-message thread on Gaza/Israel, Iran strikes, US imperialism — with one borderline-targeting moment that gets walked back, Priya disclosing personal stakes, Mei surfacing sourced data.

### Bug fixes

- Reseed FK violation: `seed.py` `force=True` now deletes `moderator_alerts`, `member_state`, `group_state` before deleting members and group.
- `steelman_missing` alert was firing on the oldest disagreement in the last-3 window; now correctly fires on the most recent.
- Wasted `ai.pause_prompt` Claude call removed when an unresolved `pause_suggested` alert already exists in the dedupe window.

### Tests

- `tests/test_ai_stubs.py` — 14 tests on heuristic fallbacks and JSON extraction.
- `tests/test_word_count.py` — 4 pure-function tests.
- `tests/test_routes.py` — 15 integration tests via FastAPI `TestClient` (skipped unless `TEST_DATABASE_URL` set).
- 18 unit tests pass without any DB or API key.

### Documentation

- Expanded `README.md`: architecture diagram, AI pipeline description, facilitation-rules table, full API reference, environment variables, project layout, roadmap.
- This `CHANGELOG.md`.

---

## phase-1 (May 14, 2026)

### Initial build

- FastAPI service with auto-seeded YGL group, 5 archetypes, ~40 messages over 2 days.
- Next.js 14 app: WhatsApp-style chat simulator (left, WhatsApp colors and bubble layout) + moderation dashboard (right, forest green).
- AI: factuality / source check (Haiku) and targeting check (Sonnet) with deterministic fallback when `ANTHROPIC_API_KEY` is unset.
- Daily moderator question + summary generator.
- Endpoints: `/chat/*`, `/test/simulate-message`, `/analyze/{id}`, `/webhook/evolution` (stub), `/daily/generate`, `/dashboard/data`.
- Rules: R1 floor balance, R5 forward friction, R6 target-vs-topic.
- `docker-compose.yml`, `Dockerfile` per service, `railway.json` per service.

### Hardening pass

- Admin endpoints (`/admin/reseed`, `/admin/reanalyze`, `/debug/ai`) gated by optional `ADMIN_TOKEN` header.
- 7-day cap on held forwards and targeted-message lists.
- Dashboard analyses query scoped to current group.
- Backfill exceptions logged instead of swallowed.
- Tightened target prompt with worked examples for "quoting language to push back."
- Connection indicator ANDs chat + dashboard state.
- `/backfill/status` endpoint.

### UX pass

- Optimistic send: message renders instantly, fades in when server confirms.
- Click flagged / unsourced chips to expand AI reasoning inline.
- "Analyzing N…" pill in dashboard header during backfill.
- Archetype legend toggle ("Who's who") in top bar.

### Deploy

- Railway: api + web + Postgres plugin. Both services on public domains.
- Fixed `anthropic==0.39.0` / `httpx>=0.28` incompatibility (`proxies` kwarg removed in httpx 0.28) by pinning `httpx<0.28`.
- Fixed `$PORT` not expanding in `railway.json` `startCommand` (removed override, Dockerfile `CMD ["sh", "-c", ...]` handles it).
- Patched Next.js CVE by bumping to `14.2.35`.
