from __future__ import annotations
import os
from typing import Optional, Dict
from datetime import datetime, date, timedelta
from collections import defaultdict
from fastapi import FastAPI, Depends, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import SessionLocal, engine, Base, get_db
from . import models, schemas, ai
from .seed import seed as run_seed


app = FastAPI(title="YGL Mod API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.Group).count() == 0:
            run_seed(force=False)
    finally:
        db.close()
    # Kick off backfill in a background thread so startup isn't blocked by AI calls
    import threading
    threading.Thread(target=_backfill_analyses_safe, daemon=True).start()


def _backfill_analyses_safe():
    db = SessionLocal()
    try:
        analyzed_ids = {a.message_id for a in db.query(models.Analysis.message_id).all()}
        msgs = db.query(models.Message).filter(~models.Message.id.in_(analyzed_ids)).all() if analyzed_ids else db.query(models.Message).all()
        for m in msgs:
            try:
                _run_analysis(db, m)
            except Exception:
                pass
    finally:
        db.close()


@app.get("/")
def root():
    return {"ok": True, "service": "ygl-mod-api"}


@app.get("/healthz")
def healthz():
    return {"ok": True}


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

    # Pull analyses for these messages
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
    # Run analysis inline so client can refresh after the call returns.
    analysis = _run_analysis(db, msg)
    return {"message_id": msg.id, "analysis_id": analysis.id if analysis else None}


# ---------- Analyze ----------

def _run_analysis(db: Session, msg: models.Message) -> "models.Analysis | None":
    existing = db.query(models.Analysis).filter(models.Analysis.message_id == msg.id).first()
    if existing:
        return existing
    fact = ai.factuality_check(msg.text, msg.is_forwarded)
    tgt = ai.target_check(msg.text)
    a = models.Analysis(
        message_id=msg.id,
        factuality_score=fact.get("confidence"),
        factuality_notes=fact.get("notes"),
        has_unsourced_claim=bool(fact.get("has_claims") and not fact.get("has_source")),
        target_flag=bool(tgt.get("target_flag")),
        target_category=tgt.get("category"),
        target_notes=tgt.get("notes"),
        topic_tags=tgt.get("topic_tags") or [],
        model="haiku+sonnet" if os.getenv("ANTHROPIC_API_KEY") else "stub",
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
    # Stub: accept any payload, dedupe by id if present, write loosely
    try:
        body = await req.json()
    except Exception:
        body = {}
    # No-op for phase 1 beyond logging. Return fast.
    return {"ok": True, "received": bool(body)}


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

    # Quiet member calc: bottom 2 by word count today
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


# ---------- Dashboard ----------

@app.get("/dashboard/data")
def dashboard_data(group_id: Optional[str] = None, db: Session = Depends(get_db)):
    g = _current_group(db, group_id)
    members = db.query(models.Member).filter(models.Member.group_id == g.id).all()
    now = datetime.utcnow()
    today_start = datetime.combine(now.date(), datetime.min.time())
    week_start = now - timedelta(days=7)

    msgs = db.query(models.Message).filter(models.Message.group_id == g.id).all()
    analyses = {a.message_id: a for a in db.query(models.Analysis).all()}

    today_total = sum(m.word_count or 0 for m in msgs if m.received_at >= today_start)
    week_total = sum(m.word_count or 0 for m in msgs if m.received_at >= week_start)

    member_tiles = []
    for mem in members:
        wc_today = sum(m.word_count or 0 for m in msgs if m.member_id == mem.id and m.received_at >= today_start)
        wc_week = sum(m.word_count or 0 for m in msgs if m.member_id == mem.id and m.received_at >= week_start)
        share_today = (wc_today / today_total) if today_total else 0
        share_week = (wc_week / week_total) if week_total else 0
        out_of_band = (share_week < 0.10) or (share_week > 0.40)
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
        })

    # Held forwards
    held = []
    for m in msgs:
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

    # Targeted messages
    targeted = []
    for m in msgs:
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

    # Topics in play (aggregate from analyses for last 48h)
    topic_counts: Dict[str, int] = defaultdict(int)
    cutoff = now - timedelta(hours=48)
    for m in msgs:
        if m.received_at < cutoff:
            continue
        a = analyses.get(m.id)
        if a and a.topic_tags:
            for t in a.topic_tags:
                topic_counts[t] += 1
    topics = sorted(topic_counts.items(), key=lambda kv: -kv[1])[:10]

    # Daily artifact (yesterday)
    yest = (now - timedelta(days=1)).date()
    artifact = (
        db.query(models.DailyArtifact)
        .filter(models.DailyArtifact.group_id == g.id, models.DailyArtifact.date == yest)
        .first()
    )

    return {
        "group": {"id": g.id, "name": g.name},
        "today_message_count": sum(1 for m in msgs if m.received_at >= today_start),
        "member_tiles": member_tiles,
        "held_forwards": held,
        "targeted_messages": targeted,
        "topics": [{"tag": t, "count": c} for t, c in topics],
        "yesterday_artifact": None if not artifact else {
            "date": str(artifact.date),
            "summary": artifact.summary,
            "suggested_question": artifact.suggested_question,
        },
    }


@app.post("/admin/reseed")
def admin_reseed(db: Session = Depends(get_db)):
    run_seed(force=True)
    import threading
    threading.Thread(target=_backfill_analyses_safe, daemon=True).start()
    return {"ok": True}


@app.post("/admin/reanalyze")
def admin_reanalyze(db: Session = Depends(get_db)):
    """Force-re-run analysis on every message. Useful after rotating ANTHROPIC_API_KEY."""
    db.query(models.Analysis).delete()
    db.commit()
    import threading
    threading.Thread(target=_backfill_analyses_safe, daemon=True).start()
    return {"ok": True, "queued": True}
