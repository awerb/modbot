# YGL Mod

A WhatsApp group moderation tool for a small Young Global Leaders discussion group on difficult conversations.

Phase 1 (what's in this branch): a working dashboard + WhatsApp-style chat simulator. Pick one of 5 archetype characters, type a message, watch the moderation panel react in real time. AI analysis (claim/source check + targeting check) runs on every new post.

Phase 2 will add heat scoring, steelman detection, repair moments, exit-velocity warnings, and the Q/A ratio.

Real WhatsApp wiring (Evolution API) comes after phase 2.

## Demo in 5 minutes locally

```bash
cp .env.example .env          # add ANTHROPIC_API_KEY if you want real AI
docker compose up --build
```

Then open:
- web: http://localhost:3000
- api: http://localhost:8000 (swagger at /docs)

The DB auto-seeds the YGL group, 5 members, and ~40 messages on first boot. To reseed:

```bash
curl -X POST http://localhost:8000/admin/reseed
```

If `ANTHROPIC_API_KEY` is not set, the analysis pipeline falls back to a deterministic heuristic so the demo still works end to end.

## Deploy to Railway in 10 minutes

1. Create a new Railway project.
2. Add the **Postgres** plugin. Railway will set `DATABASE_URL` on services that reference it.
3. Add service **api** from this repo, root directory `api/`. Railway will use `api/Dockerfile`. Set env vars:
   - `ANTHROPIC_API_KEY` = your key
   - `DATABASE_URL` = reference variable from the Postgres plugin
4. Add service **web** from this repo, root directory `web/`. Railway will use `web/Dockerfile`. Set env vars:
   - `API_INTERNAL_URL` = the internal URL of the **api** service (e.g. `http://api.railway.internal:8000`)
5. Generate public domains for both services. The web service is the demo URL you share.

Env var reference:

| var | where | what |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | api | Anthropic key. Sonnet for analysis, Haiku for triage. |
| `DATABASE_URL` | api | Postgres URL. Railway plugin sets this. |
| `API_INTERNAL_URL` | web | Internal URL for the FastAPI service. Used by the Next.js `/api/*` proxy. |

## The 5 archetypes

You "become" one of these in the chat simulator. Each is a real type of person you'll find in a discussion group on hard topics, and a real moderation challenge.

1. **Amara Okonkwo — The Bridge-Builder.** Nigerian-British social entrepreneur. Asks questions, summarizes others, steelmans before disagreeing. Healthy facilitator energy.
2. **Daniel Stern — The Provocateur.** American VC. Posts forwarded articles with hot takes, drops statistics without sources, tends to absolutes, occasionally condescending.
3. **Mei Lin — The Quiet Expert.** Singaporean climate scientist. Posts rarely but substantively. Long-form, sourced, careful. The kind of contributor a good moderator surfaces.
4. **Rafael Cardozo — The Personal-Stakes Voice.** Brazilian human rights lawyer. Brings lived experience into abstract debates, sometimes gets heated when others speak abstractly about issues that affect his communities.
5. **Priya Anand — The Synthesizer.** Indian policy advisor. Posts medium frequency, tries to find the structural frame, occasionally talks past people's actual concerns.

## Phase 1 scope (this branch)

- Schema + seeded mock data (group, 5 members, ~40 messages over 2 days)
- WhatsApp-style chat simulator on the left (~60%)
- Moderation dashboard on the right (~40%), mobile drawer
- Endpoints: `/webhook/evolution` (stub), `/analyze/{id}`, `/daily/generate`, `/dashboard/data`, `/test/simulate-message`, `/chat/messages`, `/chat/members`
- Per-message claim/factuality check (Haiku) and targeting check (Sonnet)
- Daily moderator question generator and daily summary
- Facilitation rules: R1 floor balance, R5 forward friction (hold + manual release stub), R6 target-vs-topic separation

Non-goals in phase 1: real Evolution API connection, sending DMs/kicks, auth, multi-group, heat/steelman/repair/exit-velocity.

## Phase 2 scope (next)

- Heat scoring + pause prompt (R3)
- Steelman detection (R2)
- Repair moments + exit velocity (R9, R10)
- Question/assertion ratio + quiet-member reward (R7, R8)
- Schema additions: `group_state`, `member_state`, `moderator_alerts`, plus columns on `analyses`
- Dashboard top strip (heat gauge, Q/A ratio, repair count), alert section, message-feed chips
- Chat simulator: pause-prompt banner, steelman-missing yellow icon, repair green star

Non-goals in phase 2: auto-sending pause/steelman messages (always human-approved), ML training.

## Layout

```
api/                 FastAPI service
  app/
    main.py          routes
    models.py        SQLAlchemy
    seed.py          group + members + ~40 messages
    ai.py            Anthropic calls (with stub fallback)
    db.py            engine + session
web/                 Next.js 14 (app router)
  app/page.tsx       split-panel demo
  app/api/[...]      proxy to FastAPI
  components/        ChatSimulator, Dashboard, Avatar
docker-compose.yml   db + api + web for local dev
```
