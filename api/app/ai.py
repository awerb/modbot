"""Anthropic API calls for analysis. All return dicts. Gracefully degrade when key missing."""
from __future__ import annotations
import os
import json
import re
from typing import Optional, List, Dict

import logging
log = logging.getLogger("ygl-mod.ai")
logging.basicConfig(level=logging.INFO)

_init_error: Optional[str] = None
try:
    from anthropic import Anthropic
    _key = os.getenv("ANTHROPIC_API_KEY")
    if _key:
        _client = Anthropic(api_key=_key, timeout=30.0, max_retries=1)
        log.info("Anthropic client initialized")
    else:
        _client = None
        log.warning("ANTHROPIC_API_KEY not set; using heuristic fallback")
except Exception as e:
    _client = None
    _init_error = repr(e)
    log.exception("Failed to initialize Anthropic client: %s", e)

MODEL_FAST = "claude-haiku-4-5-20251001"
MODEL_SMART = "claude-sonnet-4-5"


def _extract_json(text: str) -> Optional[dict]:
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ============ Heuristic fallbacks (when no API key) ============

def _stub_factuality(text: str, is_forwarded: bool) -> dict:
    has_number = bool(re.search(r"\d", text))
    has_source = bool(re.search(r"(study|paper|source|cite|http|nber|brookings|heritage|fair|oecd|un|who|icrc|lancet|iaea|csis)", text, re.I))
    has_claims = is_forwarded or has_number
    return {
        "has_claims": has_claims,
        "claims": [],
        "has_source": has_source,
        "confidence": 0.4,
        "notes": "Heuristic fallback (no ANTHROPIC_API_KEY set).",
    }


def _stub_target(text: str) -> dict:
    lower = text.lower()
    flag = any(
        phrase in lower
        for phrase in [
            "useful idiot", "couldn't tell you where", "freshman seminar",
            "couldn't make it work", "gaming the system", "opportunists",
        ]
    )
    tags = []
    for k in ["gaza", "iran", "israel", "imperialism", "policy", "ceasefire", "sanctions", "arms"]:
        if k in lower:
            tags.append(k)
    return {
        "target_flag": flag,
        "category": "other" if flag else None,
        "topic_only": not flag,
        "severity": "med" if flag else "low",
        "notes": "Heuristic fallback." if flag else "",
        "topic_tags": tags[:5],
    }


def _stub_deep(text: str) -> dict:
    lower = text.lower()
    heat_words = ["genocide", "lie", "propaganda", "denial", "blinded", "useful idiot", "should be ashamed", "morally bankrupt"]
    heat = min(1.0, sum(0.2 for w in heat_words if w in lower))
    is_q = text.strip().endswith("?")
    is_disagree = any(p in lower for p in ["that is not", "that's not", "you're wrong", "i disagree", "no.", "stop"])
    is_repair = any(p in lower for p in ["i'm sorry", "fair point", "i'll pull that back", "you're right", "i didn't know", "thank you for"])
    return {
        "heat_score": round(heat, 2),
        "is_disagreement": is_disagree,
        "steelman_present": False,
        "is_question": is_q,
        "is_assertion": not is_q,
        "is_repair": is_repair,
        "repair_notes": "Heuristic." if is_repair else "",
        "references_member": None,
    }


# ============ Public API ============

def factuality_check(text: str, is_forwarded: bool) -> dict:
    if not _client:
        return _stub_factuality(text, is_forwarded)
    prompt = f"""You are checking a single chat message for factual claims. Don't verify them, just identify.

Message (is_forwarded={is_forwarded}):
\"\"\"{text}\"\"\"

Respond with ONLY a JSON object:
{{"has_claims": bool, "claims": [str], "has_source": bool, "confidence": 0-1, "notes": str}}"""
    try:
        resp = _client.messages.create(
            model=MODEL_FAST,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        out = _extract_json(resp.content[0].text)
        return out or _stub_factuality(text, is_forwarded)
    except Exception as e:
        log.exception("factuality_check AI error: %s", e)
        return {**_stub_factuality(text, is_forwarded), "notes": f"AI error: {e}"}


def target_check(text: str) -> dict:
    if not _client:
        return _stub_target(text)
    prompt = f"""You moderate a Young Global Leaders discussion group on difficult topics. Apply this bar precisely:

FLAG only if the speaker themselves is demeaning a group, OR if a reasonable member of an affected group would feel targeted by what the speaker is asserting.

Do NOT flag:
- Discussion of race/gender/religion/politics/class as topics
- Quoting or paraphrasing someone else's targeting language in order to push back, critique, or call it out
- Personal experience or lived testimony, even when heated
- Sharp policy disagreement that doesn't disparage people

Examples:
- "These migrants are gaming the system" -> FLAG (speaker demeans a group)
- "When you say 'these people from those countries,' please be careful, that language demeans whole nationalities" -> DO NOT FLAG (speaker is critiquing the language, not using it)
- "I'm tired of how this conversation keeps reducing my community to a labor input" -> DO NOT FLAG (personal pushback, not targeting)

Message:
\"\"\"{text}\"\"\"

Respond with ONLY a JSON object:
{{"target_flag": bool, "category": "race"|"gender"|"religion"|"class"|"nationality"|"other"|null, "topic_only": bool, "severity": "low"|"med"|"high", "notes": str (one sentence explaining the call), "topic_tags": [str]}}"""
    try:
        resp = _client.messages.create(
            model=MODEL_SMART,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        out = _extract_json(resp.content[0].text)
        return out or _stub_target(text)
    except Exception as e:
        log.exception("target_check AI error: %s", e)
        return {**_stub_target(text), "notes": f"AI error: {e}"}


def deep_analysis(text: str, context: str = "") -> dict:
    """Phase 2: classify heat, disagreement, steelman, question/assertion, repair. One Sonnet call."""
    if not _client:
        return _stub_deep(text)
    ctx_block = f"Recent context (previous 6 messages, for grounding):\n{context}\n\n" if context else ""
    prompt = f"""You are analyzing one message from a heated but moderated discussion group on geopolitics. Classify it precisely.

{ctx_block}MESSAGE TO CLASSIFY:
\"\"\"{text}\"\"\"

Definitions:
- heat_score (0..1): emotional intensity / charge. 0 = calm, dispassionate. 0.5 = animated. 1 = personal attack, contempt, or visceral grief. Heat is about *how* not *what*.
- is_disagreement: speaker is contradicting or pushing back on a prior point. Not just stating an opinion.
- steelman_present: when disagreeing, did the speaker first acknowledge or fairly represent the other view? Only true if disagreement is also true.
- is_question: speaker is asking, soliciting, opening space.
- is_assertion: speaker is making a claim or stating a position.
- is_repair: speaker is walking back, apologizing, acknowledging harm caused by their own prior post, or thanking someone for a correction. Mark this generously, it's important.
- repair_notes: if is_repair, one short sentence explaining what was repaired.
- references_member: if the message is responding to a specific named member, return that display name. Else null.

Respond with ONLY a JSON object:
{{"heat_score": float, "is_disagreement": bool, "steelman_present": bool, "is_question": bool, "is_assertion": bool, "is_repair": bool, "repair_notes": str, "references_member": str|null}}"""
    try:
        resp = _client.messages.create(
            model=MODEL_SMART,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        out = _extract_json(resp.content[0].text)
        if not out:
            return _stub_deep(text)
        # normalize
        out["heat_score"] = max(0.0, min(1.0, float(out.get("heat_score") or 0)))
        return out
    except Exception as e:
        log.exception("deep_analysis AI error: %s", e)
        return _stub_deep(text)


def daily_question(transcript: str, quiet_members: List[dict]) -> str:
    if not _client:
        if quiet_members and quiet_members[0].get("last_substantive"):
            qm = quiet_members[0]
            return f"{qm['display_name']} made a point yesterday about {qm['last_substantive'][:80]}... Could we sit with that for a moment before moving on?"
        return "Yesterday's thread surfaced a real tension between strategy framing and lived stakes. Whose framing do you find hardest to argue with, and why?"
    prompt = f"""You are a thoughtful moderator for a Young Global Leaders discussion group on difficult conversations.

Today's transcript:
{transcript[:6000]}

Quiet members (low word share recently) and their last substantive post:
{json.dumps(quiet_members, indent=2)[:1500]}

Write ONE question (2 sentences max) to seed tomorrow's discussion. If a quiet member posted something substantive, reference them BY NAME. Otherwise surface a real tension in the thread. Direct, no preamble. Don't use emdashes."""
    try:
        resp = _client.messages.create(
            model=MODEL_SMART,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    except Exception:
        return "Yesterday's thread surfaced a tension between strategy framing and lived stakes. Whose framing do you find hardest to argue with, and why?"


def daily_summary(transcript: str) -> str:
    if not _client:
        return "- Group debated Gaza, Iran strikes, and whether the US is an imperial power\n- Michael forwarded unsourced pieces; Amara and Priya pushed back\n- Mei provided sourced evidence on arms transfers and enrichment levels\n- One exchange came close to targeting language and was named in-thread, speaker walked it back\n- Priya disclosed personal stakes; group adjusted tone"
    prompt = f"""Summarize this group chat from the last 24 hours in 4-6 short neutral bullets. No emdashes. No editorializing.

Transcript:
{transcript[:6000]}"""
    try:
        resp = _client.messages.create(
            model=MODEL_FAST,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    except Exception:
        return "- (summary unavailable)"


def pause_prompt(transcript_tail: str) -> str:
    """Generate a soft pause / re-grounding prompt the moderator can send if heat is sustained."""
    if not _client:
        return "Pausing for a moment. We're all engaged because this matters. Can we name what we're each carrying into this, and then come back to what we actually disagree about?"
    prompt = f"""The discussion is sustained high heat. You are drafting a single brief message a moderator could paste into the group to lower temperature without shutting down disagreement.

Last several messages:
{transcript_tail[:3000]}

Write ONE message, 2-3 sentences, that:
- Names that things are heated without scolding
- Invites people to slow down, not stop
- Stays respectful of the disagreement, doesn't paper over it
- No emdashes, no platitudes

Output just the message text, nothing else."""
    try:
        resp = _client.messages.create(
            model=MODEL_SMART,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    except Exception:
        return "Pausing for a moment. This matters to all of us. Can we slow down and name what we're carrying in before we name what we disagree on?"
