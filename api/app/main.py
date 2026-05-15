from __future__ import annotations
import os
import logging
from typing import Optional, Dict, List
from datetime import datetime, date, timedelta
from collections import defaultdict
from fastapi import FastAPI, Depends, HTTPException, Request, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from .db import SessionLocal, engine, Base, get_db
from . import models, schemas, ai
from .seed import seed as run_seed


log = logging.getLogger("ygl-mod.api")
logging.basicConfig(level=logging.INFO)


app = FastAPI(title="YGL Mod API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


PHASE2_COLUMNS = [
    ("heat_score", "DOUBLE PRECISION"),
    ("is_disagreement", "BOOLEAN DEFAULT FALSE"),
    ("steelman_present", "BOOLEAN DEFAULT FALSE"),
    ("is_question", "BOOLEAN DEFAULT FALSE"),
    ("is_assertion", "BOOLEAN DEFAULT FALSE"),
    ("is_repair", "BOOLEAN DEFAULT FALSE"),
    ("repair_notes", "TEXT"),
    ("references_member_id", "VARCHAR"),
]


def _ensure_phase2_columns():
    """Add phase-2 columns to analyses table if missing. Postgres-safe."""
    with engine.begin() as conn:
        for col, ddl in PHASE2_COLUMNS:
            try:
                conn.execute(sql_text(f"ALTER TABLE analyses ADD COLUMN IF NOT EXISTS {col} {ddl}"))
            except Exception as e:
                log.warning("ALTER analyses ADD %s failed (likely already exists): %s", col, e)


@app.on_event("startup")
def _startup():
    Base.metadata.create_all(bind=engine)
    _ensure_phase2_columns()
    db = SessionLocal()
    try:
        if db.query(models.Group).count() == 0:
            run_seed(force=False)
    finally:
        db.close()
    import threading
    threading.Thread(target=_backfill_analyses_safe, daemon=True).start()


def _backfill_analyses_safe():
    db = SessionLocal()
    try:
        analyzed_ids = {a.message_id for a in db.query(models.Analysis.message_id).all()}
        msgs = db.query(models.Message).filter(~models.Message.id.in_(analyzed_ids)).all() if analyzed_ids else db.query(models.Message).all()
        log.info("backfill starting for %d messages", len(msgs))
        ok = err = 0
        for m in msgs:
            try:
                _run_analysis(db, m)
                ok += 1
            except Exception as e:
                err += 1
                log.exception("backfill analysis failed for message %s: %s", m.id, e)
        log.info("backfill finished ok=%d err=%d", ok, err)
        # After backfill, run a single pass to compute group/member state and emit alerts
        try:
            _recompute_state_and_alerts(db)
        except Exception as e:
            log.exception("state recompute failed: %s", e)
    finally:
        db.close()


def _require_admin(x_admin_token: Optional[str] = Header(default=None)):
    expected = os.getenv("ADMIN_TOKEN")
    if expected and x_admin_token != expected:
        raise HTTPException(401, "admin token required")


@app.get("/")
def root():
    return {"ok": True, "service": "ygl-mod-api"}


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/debug/ai")
def debug_ai(_=Depends(_require_admin)):
    has_key = bool(os.getenv("ANTHROPIC_API_KEY"))
    client_ok = ai._client is not None
    sample = ai.target_check("Test message about immigration policy.")
    return {
        "has_anthropic_key": has_key,
        "client_initialized": client_ok,
        "sample_target_check": sample,
        "model_fast": ai.MODEL_FAST,
        "model_smart": ai.MODEL_SMART,
    }


def _current_group(db: Session, group_id: Optional[str] = None) -> models.Group:
    q = db.query(models.Group)
    if group_id:
        g = q.filter(models.Group.id == group_id).first()
    else:
        g = q.first()
    if not g:
        raise HTTPException(404, "no group")
    return g


def _word_count(s: str) -> int:
    return len([w for w in (s or "").split() if w.strip()])


# ---------- Chat ----------

@app.get("/chat/messages")
def chat_messages(group_id: Optional[str] = None, since: Optional[str] = None, db: Session = Depends(get_db)):
    g = _current_group(db, group_id)
    q = db.query(models.Message).filter(models.Message.group_id == g.id)
    if since:
        try:
            ts = datetime.fromisoformat(since.replace("Z", "+00:00"))
            q = q.filter(models.Message.received_at > ts)
        except Exception:
            pass
    msgs = q.order_by(models.Message.received_at.asc()).all()
    members = {m.id: m for m in db.query(models.Member).filter(models.Member.group_id == g.id).all()}

    ids = [m.id for m in msgs]
    analyses_by_msg: Dict[str, "models.Analysis"] = {}
    if ids:
        for a in db.query(models.Analysis).filter(models.Analysis.message_id.in_(ids)).all():
            analyses_by_msg[a.message_id] = a

    out = []
    for m in msgs:
        mem = members.get(m.member_id)
        a = analyses_by_msg.get(m.id)
        out.append({
            "id": m.id,
            "text": m.text,
            "is_forwarded": m.is_forwarded,
            "forward_friction_status": m.forward_friction_status,
            "received_at": m.received_at.isoformat(),
            "source": m.source,
            "word_count": m.word_count,
            "member": {
                "id": mem.id if mem else None,
                "display_name": mem.display_name if mem else "?",
                "archetype": mem.archetype if mem else "",
                "avatar_color": mem.avatar_color if mem else "#888",
                "avatar_initial": mem.avatar_initial if mem else "?",
            },
            "analysis": None if not a else {
                "target_flag": a.target_flag,
                "target_category": a.target_category,
                "has_unsourced_claim": a.has_unsourced_claim,
                "topic_tags": a.topic_tags or [],
                "factuality_notes": a.factuality_notes,
                "target_notes": a.target_notes,
                "heat_score": a.heat_score,
                "is_disagreement": a.is_disagreement,
                "steelman_present": a.steelman_present,
                "is_question": a.is_question,
                "is_repair": a.is_repair,
                "repair_notes": a.repair_notes,
            },
        })
    return {"group_id": g.id, "group_name": g.name, "messages": out}


@app.get("/chat/members")
def chat_members(group_id: Optional[str] = None, db: Session = Depends(get_db)):
    g = _current_group(db, group_id)
    members = db.query(models.Member).filter(models.Member.group_id == g.id).all()
    return {
        "group_id": g.id,
        "group_name": g.name,
        "members": [
            {
                "id": m.id,
                "display_name": m.display_name,
                "archetype": m.archetype,
                "avatar_color": m.avatar_color,
                "avatar_initial": m.avatar_initial,
            }
            for m in members
        ],
    }


# ---------- Simulate ----------

@app.post("/test/simulate-message")
def simulate_message(body: schemas.SimulateMessageIn, db: Session = Depends(get_db)):
    g = _current_group(db, body.group_id)
    mem = db.query(models.Member).filter(models.Member.id == body.member_id, models.Member.group_id == g.id).first()
    if not mem:
        raise HTTPException(404, "member not found")
    msg = models.Message(
        group_id=g.id,
        member_id=mem.id,
        text=body.text,
        word_count=_word_count(body.text),
        is_forwarded=body.is_forwarded,
        forward_friction_status="held" if body.is_forwarded else "n/a",
        has_media=False,
        received_at=datetime.utcnow(),
        source="simulated",
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    msg_id = msg.id

    # Run analysis + recompute on a background thread so the POST returns fast.
    # Frontend polling will pick up the analysis when it lands.
    def _bg():
        bg = SessionLocal()
        try:
            m = bg.query(models.Message).filter(models.Message.id == msg_id).first()
            if not m:
                return
            _run_analysis(bg, m)
            _recompute_state_and_alerts(bg)
        except Exception as e:
            log.exception("background analysis failed: %s", e)
        finally:
            bg.close()
    import threading
    threading.Thread(target=_bg, daemon=True).start()

    return {"message_id": msg_id, "analysis_id": None}


# ---------- Analyze ----------

def _transcript_tail(db: Session, group_id: str, before: datetime, n: int = 6) -> str:
    rows = (
        db.query(models.Message, models.Member)
        .join(models.Member, models.Member.id == models.Message.member_id)
        .filter(models.Message.group_id == group_id, models.Message.received_at < before)
        .order_by(models.Message.received_at.desc())
        .limit(n)
        .all()
    )
    rows = list(reversed(rows))
    return "\n".join(f"{mem.display_name}: {m.text}" for (m, mem) in rows)


import re as _re_topics


def _normalize_tags(tags) -> List[str]:
    """Lowercase, replace separators with _, dedupe. Keeps topic clouds clean."""
    out: List[str] = []
    seen = set()
    for t in tags or []:
        if not t:
            continue
        s = _re_topics.sub(r"[\s/\\-]+", "_", str(t).strip().lower())
        s = _re_topics.sub(r"[^a-z0-9_]", "", s)
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _run_analysis(db: Session, msg: models.Message) -> "models.Analysis | None":
    existing = db.query(models.Analysis).filter(models.Analysis.message_id == msg.id).first()
    if existing:
        return existing
    fact = ai.factuality_check(msg.text, msg.is_forwarded)
    tgt = ai.target_check(msg.text)
    ctx = _transcript_tail(db, msg.group_id, msg.received_at, n=6)
    member_names = [
        n for (n,) in db.query(models.Member.display_name).filter(models.Member.group_id == msg.group_id).all()
    ]
    deep = ai.deep_analysis(msg.text, ctx, member_names=member_names)

    # Resolve references_member name -> id
    ref_member_id = None
    ref_name = deep.get("references_member")
    if ref_name:
        ref = (
            db.query(models.Member)
            .filter(models.Member.group_id == msg.group_id, models.Member.display_name == ref_name)
            .first()
        )
        if ref:
            ref_member_id = ref.id

    a = models.Analysis(
        message_id=msg.id,
        factuality_score=fact.get("confidence"),
        factuality_notes=fact.get("notes"),
        has_unsourced_claim=bool(fact.get("has_claims") and not fact.get("has_source")),
        target_flag=bool(tgt.get("target_flag")),
        target_category=tgt.get("category"),
        target_notes=tgt.get("notes"),
        topic_tags=_normalize_tags(tgt.get("topic_tags")),
        model="haiku+sonnet" if os.getenv("ANTHROPIC_API_KEY") else "stub",
        heat_score=deep.get("heat_score"),
        is_disagreement=bool(deep.get("is_disagreement")),
        steelman_present=bool(deep.get("steelman_present")),
        is_question=bool(deep.get("is_question")),
        is_assertion=bool(deep.get("is_assertion")),
        is_repair=bool(deep.get("is_repair")),
        repair_notes=deep.get("repair_notes"),
        references_member_id=ref_member_id,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@app.post("/analyze/{message_id}")
def analyze(message_id: str, db: Session = Depends(get_db)):
    msg = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not msg:
        raise HTTPException(404, "message not found")
    existing = db.query(models.Analysis).filter(models.Analysis.message_id == message_id).first()
    if existing:
        return {"message_id": message_id, "analysis_id": existing.id, "cached": True}
    a = _run_analysis(db, msg)
    return {"message_id": message_id, "analysis_id": a.id, "cached": False}


# ---------- Webhook ----------

@app.post("/webhook/evolution")
async def webhook(req: Request, db: Session = Depends(get_db)):
    try:
        body = await req.json()
    except Exception:
        body = {}
    return {"ok": True, "received": bool(body)}


# ---------- State + alerts (Phase 2) ----------

def _has_recent_unresolved_alert(db: Session, group_id: str, kind: str, window_min: int) -> bool:
    cutoff = datetime.utcnow() - timedelta(minutes=window_min)
    return db.query(models.ModeratorAlert).filter(
        models.ModeratorAlert.group_id == group_id,
        models.ModeratorAlert.kind == kind,
        models.ModeratorAlert.resolved_at.is_(None),
        models.ModeratorAlert.created_at >= cutoff,
    ).first() is not None


def _emit_alert(db: Session, group_id: str, kind: str, payload: dict, dedupe_window_min: int = 30):
    """Emit an alert unless an unresolved one of the same kind exists within the dedupe window."""
    cutoff = datetime.utcnow() - timedelta(minutes=dedupe_window_min)
    existing = (
        db.query(models.ModeratorAlert)
        .filter(
            models.ModeratorAlert.group_id == group_id,
            models.ModeratorAlert.kind == kind,
            models.ModeratorAlert.resolved_at.is_(None),
            models.ModeratorAlert.created_at >= cutoff,
        )
        .first()
    )
    if existing:
        return
    db.add(models.ModeratorAlert(group_id=group_id, kind=kind, payload=payload))
    db.commit()


def _recompute_state_and_alerts(db: Session):
    try:
        _recompute_state_and_alerts_inner(db)
    except Exception as e:
        log.exception("recompute failed, rolling back: %s", e)
        try:
            db.rollback()
        except Exception:
            pass


def _recompute_state_and_alerts_inner(db: Session):
    g = db.query(models.Group).first()
    if not g:
        return
    members = db.query(models.Member).filter(models.Member.group_id == g.id).all()
    members_by_id = {m.id: m for m in members}

    msgs = (
        db.query(models.Message)
        .filter(models.Message.group_id == g.id)
        .order_by(models.Message.received_at.asc())
        .all()
    )
    if not msgs:
        return
    a_by_msg = {a.message_id: a for a in db.query(models.Analysis).filter(models.Analysis.message_id.in_([m.id for m in msgs])).all()}

    # Rolling heat over last 5 messages
    last_5 = msgs[-5:]
    last_5_heats = [(a_by_msg.get(m.id).heat_score if a_by_msg.get(m.id) and a_by_msg.get(m.id).heat_score is not None else 0.0) for m in last_5]
    rolling = sum(last_5_heats) / len(last_5_heats) if last_5_heats else 0.0

    # Heat threshold: if last 3 messages each above 0.65, suggest pause
    last_3 = msgs[-3:]
    hot_streak = (
        len(last_3) >= 3
        and all(
            a_by_msg.get(m.id) and (a_by_msg.get(m.id).heat_score or 0) >= 0.65
            for m in last_3
        )
    )

    # Q/A ratio over last 7d
    week_ago = datetime.utcnow() - timedelta(days=7)
    qs = sum(1 for m in msgs if m.received_at >= week_ago and a_by_msg.get(m.id) and a_by_msg.get(m.id).is_question)
    ass = sum(1 for m in msgs if m.received_at >= week_ago and a_by_msg.get(m.id) and a_by_msg.get(m.id).is_assertion)
    qa_ratio = (qs / ass) if ass else 0.0

    # Upsert GroupState
    gs = db.query(models.GroupState).filter(models.GroupState.group_id == g.id).first()
    if not gs:
        gs = models.GroupState(group_id=g.id)
        db.add(gs)
    gs.rolling_heat = round(rolling, 3)
    gs.question_assertion_ratio_7d = round(qa_ratio, 3)
    gs.updated_at = datetime.utcnow()
    db.commit()

    # Member state recompute. Keep an in-memory map so the exit-velocity loop
    # below doesn't have to re-query.
    ms_by_member: Dict[str, "models.MemberState"] = {}
    for mem in members:
        ms = db.query(models.MemberState).filter(models.MemberState.member_id == mem.id).first()
        if not ms:
            ms = models.MemberState(group_id=g.id, member_id=mem.id)
            db.add(ms)
        mem_msgs = [m for m in msgs if m.member_id == mem.id]
        ms.last_substantive_post_at = next(
            (m.received_at for m in reversed(mem_msgs) if (m.word_count or 0) >= 25), None
        )
        contested = [
            m for m in mem_msgs
            if a_by_msg.get(m.id) and (a_by_msg.get(m.id).is_disagreement or (a_by_msg.get(m.id).heat_score or 0) >= 0.5)
        ]
        ms.last_contested_exchange_at = contested[-1].received_at if contested else None
        ms.silent_since = mem_msgs[-1].received_at if mem_msgs else None
        ms.repair_count = sum(1 for m in mem_msgs if a_by_msg.get(m.id) and a_by_msg.get(m.id).is_repair)
        ms.steelman_count = sum(1 for m in mem_msgs if a_by_msg.get(m.id) and a_by_msg.get(m.id).is_disagreement and a_by_msg.get(m.id).steelman_present)
        ms_by_member[mem.id] = ms
    db.commit()

    # Alerts
    if hot_streak and not _has_recent_unresolved_alert(db, g.id, "pause_suggested", 30):
        prompt_msg = ai.pause_prompt(_transcript_tail(db, g.id, datetime.utcnow(), n=6))
        _emit_alert(db, g.id, "pause_suggested", {"rolling_heat": rolling, "draft": prompt_msg}, dedupe_window_min=30)
        gs.last_pause_prompt_at = datetime.utcnow()
        db.commit()

    # Steelman missing: most recent disagreement in last 3 without steelman
    for m in reversed(last_3):
        a = a_by_msg.get(m.id)
        if a and a.is_disagreement and not a.steelman_present and (a.heat_score or 0) >= 0.4:
            mem = members_by_id.get(m.member_id)
            _emit_alert(
                db, g.id, "steelman_missing",
                {"message_id": m.id, "member": mem.display_name if mem else "?", "text_snippet": m.text[:160]},
                dedupe_window_min=10,
            )
            break

    # Repair detected: any new repair in last 5
    for m in last_5:
        a = a_by_msg.get(m.id)
        if a and a.is_repair:
            mem = members_by_id.get(m.member_id)
            _emit_alert(
                db, g.id, "repair_detected",
                {"message_id": m.id, "member": mem.display_name if mem else "?", "notes": a.repair_notes or ""},
                dedupe_window_min=120,
            )

    # Exit velocity: member with contested exchange in last 7d but silent >= 48h
    now = datetime.utcnow()
    for mem in members:
        ms = ms_by_member.get(mem.id)
        if not ms or not ms.last_contested_exchange_at or not ms.silent_since:
            continue
        contested = ms.last_contested_exchange_at
        silent_for = now - ms.silent_since
        if contested >= now - timedelta(days=7) and silent_for >= timedelta(hours=48):
            _emit_alert(
                db, g.id, "exit_velocity",
                {"member": mem.display_name, "silent_hours": int(silent_for.total_seconds() / 3600)},
                dedupe_window_min=240,
            )

    # Quiet member substantive: a member with low word share (< 0.1) who posted a substantive message in last 24h
    cutoff = now - timedelta(hours=24)
    week_msgs = [m for m in msgs if m.received_at >= week_ago]
    week_total = sum(m.word_count or 0 for m in week_msgs) or 1
    for mem in members:
        share = sum(m.word_count or 0 for m in week_msgs if m.member_id == mem.id) / week_total
        if share >= 0.10:
            continue
        recent_sub = [m for m in msgs if m.member_id == mem.id and m.received_at >= cutoff and (m.word_count or 0) >= 25]
        if recent_sub:
            _emit_alert(
                db, g.id, "quiet_member_substantive",
                {"member": mem.display_name, "text_snippet": recent_sub[-1].text[:160]},
                dedupe_window_min=720,
            )


# ---------- Daily ----------

@app.post("/daily/generate")
def daily_generate(group_id: Optional[str] = None, target_date: Optional[str] = None, db: Session = Depends(get_db)):
    g = _current_group(db, group_id)
    if target_date:
        d = date.fromisoformat(target_date)
    else:
        d = (datetime.utcnow() - timedelta(days=1)).date()

    start = datetime.combine(d, datetime.min.time())
    end = start + timedelta(days=1)
    msgs = (
        db.query(models.Message)
        .filter(models.Message.group_id == g.id, models.Message.received_at >= start, models.Message.received_at < end)
        .order_by(models.Message.received_at.asc())
        .all()
    )
    members = {m.id: m for m in db.query(models.Member).filter(models.Member.group_id == g.id).all()}
    transcript = "\n".join(f"{members[m.member_id].display_name}: {m.text}" for m in msgs if m.member_id in members)

    word_share: Dict[str, int] = defaultdict(int)
    last_substantive: Dict[str, str] = {}
    for m in msgs:
        word_share[m.member_id] += m.word_count or 0
        if (m.word_count or 0) >= 25:
            last_substantive[m.member_id] = m.text

    quiet = sorted(members.values(), key=lambda mm: word_share.get(mm.id, 0))[:2]
    quiet_payload = [
        {
            "display_name": qm.display_name,
            "word_count_today": word_share.get(qm.id, 0),
            "last_substantive": last_substantive.get(qm.id, ""),
        }
        for qm in quiet
    ]

    summary = ai.daily_summary(transcript) if transcript else "- no messages"
    question = ai.daily_question(transcript, quiet_payload) if transcript else "What would you like to dig into today?"

    art = (
        db.query(models.DailyArtifact)
        .filter(models.DailyArtifact.group_id == g.id, models.DailyArtifact.date == d)
        .first()
    )
    if not art:
        art = models.DailyArtifact(group_id=g.id, date=d)
        db.add(art)
    art.summary = summary
    art.suggested_question = question
    db.commit()
    db.refresh(art)
    return {
        "id": art.id,
        "date": str(art.date),
        "summary": art.summary,
        "suggested_question": art.suggested_question,
    }


# ---------- Alerts ----------

@app.get("/alerts")
def list_alerts(group_id: Optional[str] = None, db: Session = Depends(get_db)):
    g = _current_group(db, group_id)
    rows = (
        db.query(models.ModeratorAlert)
        .filter(models.ModeratorAlert.group_id == g.id, models.ModeratorAlert.resolved_at.is_(None))
        .order_by(models.ModeratorAlert.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        "alerts": [
            {
                "id": r.id,
                "kind": r.kind,
                "payload": r.payload,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
    }


@app.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str, db: Session = Depends(get_db)):
    a = db.query(models.ModeratorAlert).filter(models.ModeratorAlert.id == alert_id).first()
    if not a:
        raise HTTPException(404, "alert not found")
    a.resolved_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


# ---------- Forward friction actions (R5) ----------

@app.post("/forwards/{message_id}/{action}")
def forward_action(message_id: str, action: str, _=Depends(_require_admin), db: Session = Depends(get_db)):
    if action not in ("release", "discard"):
        raise HTTPException(400, "action must be 'release' or 'discard'")
    m = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not m:
        raise HTTPException(404, "message not found")
    if not m.is_forwarded:
        raise HTTPException(400, "not a forwarded message")
    m.forward_friction_status = "released" if action == "release" else "discarded"
    db.commit()
    return {"ok": True, "status": m.forward_friction_status}


# ---------- Dashboard ----------

@app.get("/dashboard/data")
def dashboard_data(group_id: Optional[str] = None, db: Session = Depends(get_db)):
    g = _current_group(db, group_id)
    members = db.query(models.Member).filter(models.Member.group_id == g.id).all()
    member_states = {ms.member_id: ms for ms in db.query(models.MemberState).filter(models.MemberState.group_id == g.id).all()}
    gs = db.query(models.GroupState).filter(models.GroupState.group_id == g.id).first()

    now = datetime.utcnow()
    today_start = datetime.combine(now.date(), datetime.min.time())
    week_start = now - timedelta(days=7)
    recent_cutoff = now - timedelta(days=7)

    msgs = db.query(models.Message).filter(models.Message.group_id == g.id).all()
    msg_ids = [m.id for m in msgs]
    analyses = (
        {a.message_id: a for a in db.query(models.Analysis).filter(models.Analysis.message_id.in_(msg_ids)).all()}
        if msg_ids else {}
    )

    today_total = sum(m.word_count or 0 for m in msgs if m.received_at >= today_start)
    week_total = sum(m.word_count or 0 for m in msgs if m.received_at >= week_start)

    member_tiles = []
    for mem in members:
        wc_today = sum(m.word_count or 0 for m in msgs if m.member_id == mem.id and m.received_at >= today_start)
        wc_week = sum(m.word_count or 0 for m in msgs if m.member_id == mem.id and m.received_at >= week_start)
        share_today = (wc_today / today_total) if today_total else 0
        share_week = (wc_week / week_total) if week_total else 0
        out_of_band = (share_week < 0.10) or (share_week > 0.40)
        ms = member_states.get(mem.id)
        # Exit velocity flag: contested in last 7d, silent >= 48h
        exit_flag = False
        if ms and ms.last_contested_exchange_at and ms.silent_since:
            silent_for = now - ms.silent_since
            if ms.last_contested_exchange_at >= now - timedelta(days=7) and silent_for >= timedelta(hours=48):
                exit_flag = True
        member_tiles.append({
            "id": mem.id,
            "display_name": mem.display_name,
            "archetype": mem.archetype,
            "avatar_color": mem.avatar_color,
            "avatar_initial": mem.avatar_initial,
            "word_count_today": wc_today,
            "word_count_week": wc_week,
            "share_today": round(share_today, 3),
            "share_week": round(share_week, 3),
            "out_of_band": out_of_band,
            "repair_count": ms.repair_count if ms else 0,
            "steelman_count": ms.steelman_count if ms else 0,
            "exit_flag": exit_flag,
        })

    held = []
    for m in msgs:
        if m.received_at < recent_cutoff:
            continue
        if m.is_forwarded and m.forward_friction_status == "held":
            mem = next((x for x in members if x.id == m.member_id), None)
            held.append({
                "id": m.id,
                "text": m.text,
                "received_at": m.received_at.isoformat(),
                "member": {
                    "display_name": mem.display_name if mem else "?",
                    "avatar_color": mem.avatar_color if mem else "#888",
                    "avatar_initial": mem.avatar_initial if mem else "?",
                },
            })

    targeted = []
    for m in msgs:
        if m.received_at < recent_cutoff:
            continue
        a = analyses.get(m.id)
        if a and a.target_flag:
            mem = next((x for x in members if x.id == m.member_id), None)
            targeted.append({
                "id": m.id,
                "text": m.text,
                "received_at": m.received_at.isoformat(),
                "category": a.target_category,
                "notes": a.target_notes,
                "member": {
                    "display_name": mem.display_name if mem else "?",
                    "avatar_color": mem.avatar_color if mem else "#888",
                    "avatar_initial": mem.avatar_initial if mem else "?",
                },
            })

    topic_counts: Dict[str, int] = defaultdict(int)
    cutoff48 = now - timedelta(hours=48)
    for m in msgs:
        if m.received_at < cutoff48:
            continue
        a = analyses.get(m.id)
        if a and a.topic_tags:
            for t in a.topic_tags:
                topic_counts[t] += 1
    topics = sorted(topic_counts.items(), key=lambda kv: -kv[1])[:10]

    yest = (now - timedelta(days=1)).date()
    artifact = (
        db.query(models.DailyArtifact)
        .filter(models.DailyArtifact.group_id == g.id, models.DailyArtifact.date == yest)
        .first()
    )

    # Active alerts
    alerts = (
        db.query(models.ModeratorAlert)
        .filter(models.ModeratorAlert.group_id == g.id, models.ModeratorAlert.resolved_at.is_(None))
        .order_by(models.ModeratorAlert.created_at.desc())
        .limit(8)
        .all()
    )
    alert_out = [
        {"id": a.id, "kind": a.kind, "payload": a.payload, "created_at": a.created_at.isoformat()}
        for a in alerts
    ]

    # Repair count week
    repair_week = sum(
        1 for m in msgs
        if m.received_at >= week_start and analyses.get(m.id) and analyses[m.id].is_repair
    )

    return {
        "group": {"id": g.id, "name": g.name},
        "today_message_count": sum(1 for m in msgs if m.received_at >= today_start),
        "group_state": {
            "rolling_heat": round(gs.rolling_heat if gs else 0.0, 3),
            "question_assertion_ratio_7d": round(gs.question_assertion_ratio_7d if gs else 0.0, 3),
            "repair_count_week": repair_week,
        },
        "member_tiles": member_tiles,
        "held_forwards": held,
        "targeted_messages": targeted,
        "topics": [{"tag": t, "count": c} for t, c in topics],
        "yesterday_artifact": None if not artifact else {
            "date": str(artifact.date),
            "summary": artifact.summary,
            "suggested_question": artifact.suggested_question,
        },
        "alerts": alert_out,
    }


@app.post("/admin/reseed")
def admin_reseed(_=Depends(_require_admin), db: Session = Depends(get_db)):
    run_seed(force=True)
    # also clear state and alerts for the (re)seeded group
    g = db.query(models.Group).first()
    if g:
        db.query(models.ModeratorAlert).filter(models.ModeratorAlert.group_id == g.id).delete()
        db.query(models.GroupState).filter(models.GroupState.group_id == g.id).delete()
        db.query(models.MemberState).filter(models.MemberState.group_id == g.id).delete()
        db.commit()
    import threading
    threading.Thread(target=_backfill_analyses_safe, daemon=True).start()
    return {"ok": True}


@app.post("/admin/reanalyze")
def admin_reanalyze(_=Depends(_require_admin), db: Session = Depends(get_db)):
    db.query(models.Analysis).delete()
    g = db.query(models.Group).first()
    if g:
        db.query(models.ModeratorAlert).filter(models.ModeratorAlert.group_id == g.id).delete()
        db.query(models.GroupState).filter(models.GroupState.group_id == g.id).delete()
        db.query(models.MemberState).filter(models.MemberState.group_id == g.id).delete()
    db.commit()
    import threading
    threading.Thread(target=_backfill_analyses_safe, daemon=True).start()
    return {"ok": True, "queued": True}


@app.get("/backfill/status")
def backfill_status(db: Session = Depends(get_db)):
    total = db.query(models.Message).count()
    analyzed = db.query(models.Analysis.message_id).distinct().count()
    return {"total": total, "analyzed": analyzed, "pending": max(0, total - analyzed)}
