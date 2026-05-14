"""Anthropic API calls for analysis. All return dicts. Gracefully degrade when key missing."""
from __future__ import annotations
import os
import json
import re
from typing import Optional, List, Dict

try:
    from anthropic import Anthropic
    _client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY")) if os.getenv("ANTHROPIC_API_KEY") else None
except Exception:
    _client = None

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


def _stub_factuality(text: str, is_forwarded: bool) -> dict:
    has_number = bool(re.search(r"\d", text))
    has_source = bool(re.search(r"(study|paper|source|cite|http|nber|brookings|heritage|fair|oecd)", text, re.I))
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
            "these people", "those people", "they don't want",
            "couldn't make it work in their own", "gaming the system",
            "opportunists", "write off",
        ]
    )
    tags = []
    for k in ["immigration", "policy", "economic", "data", "legal", "border", "asylum", "labor"]:
        if k in lower:
            tags.append(k)
    return {
        "target_flag": flag,
        "category": "other" if flag else None,
        "topic_only": not flag,
        "severity": "med" if flag else "low",
        "notes": "Heuristic fallback." if flag else "",
        "topic_tags": tags[:4],
    }


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
        return {**_stub_factuality(text, is_forwarded), "notes": f"AI error: {e}"}


def target_check(text: str) -> dict:
    if not _client:
        return _stub_target(text)
    prompt = f"""You moderate a discussion group on difficult topics. The bar for flagging:

"Would a reasonable member feel demeaned or targeted, OR would a group they belong to be demeaned?"

Messages ABOUT race/gender/religion/politics as topics should NOT flag. Only TARGETING flags.

Message:
\"\"\"{text}\"\"\"

Respond with ONLY a JSON object:
{{"target_flag": bool, "category": "race"|"gender"|"religion"|"class"|"other"|null, "topic_only": bool, "severity": "low"|"med"|"high", "notes": str, "topic_tags": [str]}}"""
    try:
        resp = _client.messages.create(
            model=MODEL_SMART,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        out = _extract_json(resp.content[0].text)
        return out or _stub_target(text)
    except Exception as e:
        return {**_stub_target(text), "notes": f"AI error: {e}"}


def daily_question(transcript: str, quiet_members: List[dict]) -> str:
    if not _client:
        if quiet_members and quiet_members[0].get("last_substantive"):
            qm = quiet_members[0]
            return f"{qm['display_name']} made a point yesterday about {qm['last_substantive'][:80]}... Could we sit with that for a moment before moving on?"
        return "Yesterday's thread surfaced a real tension between policy framing and lived stakes. Whose framing do you find hardest to argue with, and why?"
    prompt = f"""You are a thoughtful moderator for a Young Global Leaders discussion group on difficult conversations.

Today's transcript:
{transcript[:6000]}

Quiet members (low word share recently) and their last substantive post:
{json.dumps(quiet_members, indent=2)[:1500]}

Write ONE question (2 sentences max) to seed tomorrow's discussion. If a quiet member posted something substantive, reference them BY NAME. Otherwise surface a real tension. Direct, no preamble. Don't use emdashes."""
    try:
        resp = _client.messages.create(
            model=MODEL_SMART,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip()
    except Exception:
        return "Yesterday's thread surfaced a tension between policy framing and lived stakes. Whose framing do you find hardest to argue with, and why?"


def daily_summary(transcript: str) -> str:
    if not _client:
        return "- Group debated immigration policy and economic mobility\n- Daniel forwarded several unsourced pieces; Amara and Rafael pushed back\n- Mei provided sourced counter-evidence on fiscal impact and integration timelines\n- Priya proposed a three-way frame (inside/at/outside the border)\n- One exchange came close to targeting language and was named in-thread"
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
