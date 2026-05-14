# Architecture

## Request flow

```
browser
  |
  |  GET /api/dashboard/data
  v
Next.js (web)            ─── app/api/[...path]/route.ts proxies to API_INTERNAL_URL
  |
  |  GET /dashboard/data
  v
FastAPI (api)            ─── app/main.py
  |   |    |
  |   |    +─── SQLAlchemy   ─── Postgres
  |   |
  |   +──── Anthropic SDK    ─── Claude (sonnet 4.5, haiku 4.5)
  |
  v
JSON response (one shot: group_state, alerts, member_tiles, held, targeted, topics, ...)
```

The browser never talks to the Python service directly. All `/api/*` calls hit a Next.js route handler that forwards to `API_INTERNAL_URL` (Railway private domain in prod, `http://api:8000` in docker-compose). This keeps the API surface single-origin and means a public domain on the API service is optional in prod.

## Data model

```
groups (id, name, whatsapp_jid, created_at)
  └── members (id, group_id, display_name, archetype, avatar_color, avatar_initial, ...)
  └── messages (id, group_id, member_id, text, word_count, is_forwarded,
                forward_friction_status, has_media, raw_payload, received_at, source)
       └── analyses (id, message_id,
                     -- phase 1 --
                     factuality_score, factuality_notes, has_unsourced_claim,
                     target_flag, target_category, target_notes, topic_tags,
                     -- phase 2 --
                     heat_score, is_disagreement, steelman_present,
                     is_question, is_assertion, is_repair, repair_notes,
                     references_member_id,
                     model, created_at)
  └── daily_artifacts (id, group_id, date, summary, suggested_question, sent_at, created_at)
  └── group_state (group_id [unique], rolling_heat, last_pause_prompt_at,
                   question_assertion_ratio_7d, updated_at)
  └── member_state (group_id, member_id [unique], last_substantive_post_at,
                    last_contested_exchange_at, silent_since,
                    repair_count, steelman_count)
  └── moderator_alerts (group_id, kind, payload jsonb, created_at, resolved_at)
```

One `analyses` row per message. `analyses.message_id` is indexed. The phase-2 columns are added at startup via `ALTER TABLE ADD COLUMN IF NOT EXISTS` so an existing phase-1 deployment can upgrade in place.

## AI pipeline

Each new message triggers three AI calls (when `ANTHROPIC_API_KEY` is set; otherwise heuristic fallbacks return reasonable shapes):

1. **`factuality_check`** (Haiku) — does the message make claims? Are sources present? Heuristic fallback uses regex on numbers and source-word vocabulary.

2. **`target_check`** (Sonnet) — does the speaker demean a group? The prompt distinguishes targeting language from topic discussion and from quoting-language-to-push-back, with three worked examples. Heuristic fallback flags messages containing specific phrases from the seed corpus.

3. **`deep_analysis`** (Sonnet) — heat (0–1), is_disagreement, steelman_present, is_question, is_assertion, is_repair, repair_notes, references_member. Takes the previous 6 messages as context so quoted material is read in context.

After analysis, `_recompute_state_and_alerts` runs synchronously:

- Updates `group_state.rolling_heat` (avg of last 5 messages' heat scores).
- Updates `group_state.question_assertion_ratio_7d` (rolling 7-day Q/A ratio).
- Upserts `member_state` rows with new last_substantive / last_contested / silent_since / repair_count / steelman_count.
- Emits alerts when rules fire (with dedupe-by-(group, kind, window)).

## Alert engine

| kind | rule | dedupe window |
|---|---|---|
| `pause_suggested` | last 3 messages each have heat ≥ 0.65 | 30 min |
| `steelman_missing` | most recent disagreement in last 3 has `heat ≥ 0.4` and `steelman_present = False` | 10 min |
| `repair_detected` | a message in last 5 has `is_repair = True` | 120 min |
| `exit_velocity` | a member had a contested exchange in last 7d AND has been silent for ≥48h | 240 min |
| `quiet_member_substantive` | member with <10% week share posted a ≥25-word message in last 24h | 720 min |

`pause_suggested` alerts carry a Sonnet-drafted pause message in `payload.draft` that the chat-side banner can copy directly into the group.

## Backfill thread

On startup (and on `/admin/reseed`, `/admin/reanalyze`), a daemon thread iterates over unanalyzed messages and runs `_run_analysis` for each. Exceptions are logged, not swallowed. The thread checks for existing analyses first (`_run_analysis` is idempotent), so a startup overlapping with concurrent posts is safe.

`/backfill/status` returns `{total, analyzed, pending}` so the UI can show an "Analyzing N…" pill in the dashboard header during the run.

## Frontend state

```
page.tsx
  ├── tab: "demo" | "about"
  ├── chatOk: boolean | null    ← ChatSimulator.onConnection
  ├── dashOk: boolean | null    ← Dashboard.onConnection
  └── connected = chatOk !== false && dashOk !== false   (AND, no flicker)

ChatSimulator
  ├── polls /chat/messages every 2.5s
  ├── polls /alerts every 2.5s (for the pause banner)
  ├── optimistic send: insert into local state immediately, drop on poll convergence
  └── stickToBottom ref: auto-scroll only when user was already near bottom

Dashboard
  ├── polls /dashboard/data every 3s
  ├── polls /backfill/status every 3s
  └── exposes refreshKey from page to force-reload after Reset demo
```

## Deployment

Two Railway services (api, web) plus the Postgres plugin. Both services build from their own `Dockerfile`; `railway.json` per service sets `healthcheckPath` on api. The Dockerfile CMD uses `sh -c` so `$PORT` expands at runtime.

The repo lives under one root; `railway up --path-as-root api` and `--path-as-root web` upload the relevant subdirectory.
