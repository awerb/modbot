# YGL Mod

A WhatsApp group moderation simulation for a small Young Global Leaders discussion group on difficult conversations.

The product question: can AI help a human moderator notice the things that actually matter (heat building, claims without sources, a quiet member who finally posted something substantive, someone who went silent after a contested exchange) without taking the human out of the loop?

Live demo: https://web-production-a9a17.up.railway.app

## What it does

- **Chat simulator** (left, WhatsApp-style). Become one of 5 archetype characters, post messages, optionally as forwards.
- **Moderator dashboard** (right). Floor balance, held forwards, targeted-language flags, topics in play, a heat gauge, Q/A ratio, repair count, moderator alerts, daily summary, suggested question.
- **AI analysis on every message:** factuality / source check, targeting check, plus heat / disagreement / steelman / question / repair classification. Real WhatsApp wiring is stubbed (`/webhook/evolution`) and comes after Phase 2.

## Demo in 5 minutes locally

```bash
cp .env.example .env          # add ANTHROPIC_API_KEY if you want real AI
docker compose up --build
```

- web: http://localhost:3000
- api: http://localhost:8000 (Swagger at `/docs`)

The DB auto-seeds 5 members and ~40 messages on first boot. To reseed:

```bash
curl -X POST http://localhost:8000/admin/reseed
```

Without `ANTHROPIC_API_KEY`, the analysis pipeline falls back to a deterministic heuristic so the demo still runs end to end.

## Deploy to Railway in 10 minutes

1. Create a new Railway project.
2. Add the **Postgres** plugin. Reference its `DATABASE_URL` from your api service.
3. **api service** from this repo, root `api/`. Set env vars:
   - `ANTHROPIC_API_KEY` = your key (optional but recommended)
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `ADMIN_TOKEN` = a secret string (optional; if set, admin endpoints require `X-Admin-Token` header)
4. **web service** from this repo, root `web/`. Set env vars:
   - `API_INTERNAL_URL` = `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8000`
5. Generate public domains for both. The web URL is the demo.

## Environment variables

| var | service | what |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | api | Anthropic key. Sonnet 4.5 for analysis, Haiku 4.5 for triage. |
| `DATABASE_URL` | api | Postgres URL. Railway plugin sets this. |
| `ADMIN_TOKEN` | api | Optional shared secret. When set, `/admin/*` and `/debug/ai` require `X-Admin-Token`. |
| `API_INTERNAL_URL` | web | Internal URL for FastAPI. Next.js `/api/*` proxies to it. |

## The 5 archetypes

You become one of these in the chat simulator. Each is a real moderation challenge.

1. **Amara Okonkwo — The Bridge-Builder.** Nigerian-British social entrepreneur. Asks questions, summarizes, steelmans before disagreeing.
2. **Michael Standup — The Provocateur.** American VC. Posts forwarded articles with hot takes, drops stats without sources, tends to absolutes.
3. **Mei Lin — The Quiet Expert.** Singaporean climate scientist. Posts rarely but substantively, sourced and careful.
4. **Rafael Cardozo — The Personal-Stakes Voice.** Brazilian human rights lawyer. Brings lived experience; pushes back when others speak abstractly about issues affecting his communities.
5. **Priya Anand — The Strident Voice.** Indian policy advisor. Emotional, names harm directly, takes the opposite position to Michael.

The seeded thread is a discussion on Gaza, the Iran strikes, and whether the US is an imperial power.

## Tests

Two test suites:

```bash
cd api
pip install -r requirements.txt
pytest                                # unit tests only (18 tests, no DB)
TEST_DATABASE_URL=postgresql://u:p@localhost:5432/modbot_test pytest    # full suite (33 tests)
```

- `tests/test_ai_stubs.py` — heuristic fallback path of `ai.py`, runs without Anthropic.
- `tests/test_word_count.py` — pure function tests.
- `tests/test_routes.py` — integration tests via FastAPI `TestClient`; auto-skip when `TEST_DATABASE_URL` is unset.

TypeScript:

```bash
cd web
npm install
npx tsc --noEmit
```

## Architecture

```
+---------------------+        +-----------------------+
|  Next.js 14 (web)   |  /api  |    FastAPI (api)      |
|  - ChatSimulator    +-------->  - routes             |
|  - Dashboard        |        |  - AI pipeline        |
|  - About tab        |        |  - alerts engine      |
+---------------------+        +-----------+-----------+
                                           |
                          Anthropic SDK    |   SQLAlchemy
                       (sonnet 4.5,        |
                        haiku 4.5)         v
                                      Postgres
                                  (groups, members,
                                   messages, analyses,
                                   group_state,
                                   member_state,
                                   moderator_alerts,
                                   daily_artifacts)
```

The Next.js `app/api/[...path]` route proxies the browser's `/api/*` calls to the FastAPI service. CORS is wide open on the api in dev / demo.

### AI pipeline

For each new message:

1. **factuality_check** (Haiku) — does the message make claims? Are any sources present?
2. **target_check** (Sonnet) — does the speaker demean a group? Topic discussion and quoting-to-push-back are explicitly not flagged via worked examples in the prompt.
3. **deep_analysis** (Sonnet) — heat score (0–1), is_disagreement, steelman_present, is_question, is_assertion, is_repair, repair_notes, references_member.

After each analysis, `_recompute_state_and_alerts` updates `group_state` (rolling heat over last 5, Q/A 7-day ratio) and `member_state` (last_substantive_post_at, last_contested_exchange_at, silent_since, repair_count, steelman_count), and emits alerts when the relevant rule fires.

## Facilitation rules wired in

| code | rule | what it does |
|---|---|---|
| R1 | Floor balance | Per-member word share, flag outside 10–40% |
| R2 | Steelman | On disagreement, check that the other view was acknowledged; emit `steelman_missing` when not |
| R3 | Heat + pause | Per-message heat 0–1, rolling avg of last 5; sustained ≥0.65 emits `pause_suggested` with a Sonnet-drafted pause message; 30-min cooldown |
| R5 | Hold forwards for review | Forwarded content gets intercepted and surfaced in a separate panel; moderator releases or drops it |
| R6 | Target vs topic | Targeting language is flagged separately from topic chips |
| R7 | Q / A ratio | 7-day rolling ratio of questions to assertions; flagged when <0.2 |
| R8 | Quiet-member reward | Quiet members (<10% share) who post substantively trigger an alert and get referenced by name in tomorrow's question |
| R9 | Repair detection | Apologies, walk-backs, acknowledgements; green star and `repair_detected` alert |
| R10 | Exit velocity | Contested exchange + 48h silence → `exit_velocity` alert (moderator-only) |

All alerts are dedupe-windowed: pause 30min, repair 120min, exit-velocity 240min, quiet-member 720min, steelman 10min.

## API reference

| method | path | what |
|---|---|---|
| GET | `/healthz` | liveness |
| GET | `/chat/messages?since=...` | full message list with analyses |
| GET | `/chat/members` | members |
| POST | `/test/simulate-message` | post a message as a member, runs analysis inline |
| POST | `/analyze/{message_id}` | (re-)analyze a single message |
| POST | `/webhook/evolution` | stub for Evolution API WhatsApp ingest |
| POST | `/daily/generate?target_date=YYYY-MM-DD` | (re)generate daily summary + suggested question |
| GET | `/dashboard/data` | everything the dashboard needs in one call |
| GET | `/alerts` | unresolved moderator alerts |
| POST | `/alerts/{id}/resolve` | dismiss an alert |
| GET | `/backfill/status` | `{total, analyzed, pending}` |
| POST | `/admin/reseed` | wipe and reseed (token-gated when `ADMIN_TOKEN` set) |
| POST | `/admin/reanalyze` | drop all analyses and re-run on backfill (token-gated) |
| GET | `/debug/ai` | Anthropic client liveness (token-gated) |

## Project layout

```
api/
  app/
    main.py        routes + alerts engine
    models.py      SQLAlchemy models (phase 1 + phase 2 schemas)
    seed.py        group + members + ~40 messages
    ai.py          Anthropic calls and heuristic fallbacks
    db.py          engine + session
  tests/           pytest unit + integration
  Dockerfile
  requirements.txt

web/
  app/
    page.tsx       Demo / About tabs
    api/[...path]  proxy to FastAPI
  components/
    ChatSimulator.tsx
    Dashboard.tsx
    AboutTab.tsx
    Avatar.tsx
  lib/api.ts       fetch wrapper with timeouts
  Dockerfile
  package.json

docker-compose.yml  db + api + web for local dev
```

## Roadmap

**Phase 3 — real wiring**
- Evolution API webhook for actual WhatsApp groups
- Outbound: moderator-approved pause prompts and steelman invitations sent back to the group
- Multi-group support (one moderator, multiple pilots)
- Member consent / opt-in flow

**Phase 4 — depth**
- Per-member tone calibration (heat read relative to baseline, not absolute)
- Thread coherence: detect when a debate is talking past itself
- Source attestation library
- Daily moderator email digest

**Open questions**
- Auto-flag aggressiveness vs. surfacing. Default is never auto-send; always human-approved.
- Heat threshold is currently 0.65; per-group tuning?
- Repair detection is intentionally generous. Worth quantifying false positives against a held-out set.
