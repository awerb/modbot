"""Tests for the heuristic fallback path in ai.py — runs without an Anthropic key."""
import os
# Force stub mode before importing ai
os.environ.pop("ANTHROPIC_API_KEY", None)

from app import ai


def test_extract_json_basic():
    assert ai._extract_json('{"a": 1}') == {"a": 1}


def test_extract_json_with_prose():
    raw = "Sure thing! Here's the result:\n\n{\"target_flag\": true, \"category\": \"other\"}\n\nLet me know."
    assert ai._extract_json(raw) == {"target_flag": True, "category": "other"}


def test_extract_json_invalid_returns_none():
    assert ai._extract_json("not json") is None
    assert ai._extract_json("") is None
    assert ai._extract_json(None) is None


def test_stub_target_clean_message():
    out = ai._stub_target("This is a thoughtful policy discussion about Gaza.")
    assert out["target_flag"] is False
    assert "gaza" in out["topic_tags"]


def test_stub_target_flags_demeaning_language():
    out = ai._stub_target("They are all useful idiots who couldn't tell you where Iran is.")
    assert out["target_flag"] is True
    assert out["category"] == "other"


def test_stub_factuality_unsourced_number():
    out = ai._stub_factuality("Iran has 84% enriched uranium at Fordow.", is_forwarded=False)
    assert out["has_claims"] is True
    # No source word present
    assert out["has_source"] is False


def test_stub_factuality_with_source():
    out = ai._stub_factuality("Per the IAEA quarterly report, enrichment is at 84%.", is_forwarded=False)
    assert out["has_claims"] is True
    assert out["has_source"] is True


def test_stub_factuality_forwarded_is_a_claim():
    out = ai._stub_factuality("Some forwarded text without a number.", is_forwarded=True)
    assert out["has_claims"] is True


def test_stub_deep_repair_detected():
    out = ai._stub_deep("Fair point, I'll pull that back.")
    assert out["is_repair"] is True
    assert out["is_disagreement"] is False


def test_stub_deep_question():
    out = ai._stub_deep("What do you think about this?")
    assert out["is_question"] is True
    assert out["is_assertion"] is False


def test_stub_deep_heat_scaling():
    calm = ai._stub_deep("Here is a sourced summary of the data.")
    hot = ai._stub_deep("That is propaganda, a lie, and pure denial.")
    assert hot["heat_score"] > calm["heat_score"]
    assert 0.0 <= hot["heat_score"] <= 1.0


def test_stub_deep_disagreement():
    out = ai._stub_deep("That is not an argument, you're wrong.")
    assert out["is_disagreement"] is True


def test_pause_prompt_returns_text_in_stub_mode():
    # Should not raise even without API key
    text = ai.pause_prompt("Some recent heated transcript...")
    assert isinstance(text, str)
    assert len(text) > 0


def test_daily_question_quiet_member_reference():
    quiet = [{"display_name": "Mei Lin", "last_substantive": "The IAEA reports 84% enrichment at Fordow."}]
    q = ai.daily_question("transcript", quiet)
    # In stub mode, references quiet member by name
    assert "Mei Lin" in q


def test_stub_deep_detects_member_full_name():
    out = ai._stub_deep("Priya Anand, with respect, the data doesn't support that.", members=["Amara Okonkwo", "Priya Anand", "Mei Lin"])
    assert out["references_member"] == "Priya Anand"


def test_stub_deep_detects_member_first_name():
    out = ai._stub_deep("Michael, that's a swipe, not an argument.", members=["Amara Okonkwo", "Michael Standup"])
    assert out["references_member"] == "Michael Standup"


def test_stub_deep_no_member_when_absent():
    out = ai._stub_deep("Sourced summary of the data posted below.", members=["Mei Lin"])
    assert out["references_member"] is None


def test_normalize_tags_dedupes_and_lowercases():
    from app.main import _normalize_tags
    out = _normalize_tags(["Gaza", "gaza", "Foreign Policy", "foreign-policy", "Foreign_Policy"])
    assert "gaza" in out
    assert "foreign_policy" in out
    # All variants of "foreign policy" collapse to one
    assert out.count("foreign_policy") == 1


def test_cost_for_haiku():
    # 1M input + 1M output at haiku rates = 1.00 + 5.00 = $6.00
    c = ai.cost_for("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)
    assert abs(c - 6.0) < 1e-6


def test_cost_for_sonnet_with_cache():
    # 100k input, 50k output, 100k cache read = 0.30 + 0.75 + 0.03 = 1.08
    c = ai.cost_for("claude-sonnet-4-5", 100_000, 50_000, cache_read=100_000)
    assert abs(c - 1.08) < 1e-6


def test_cost_for_unknown_model():
    assert ai.cost_for("claude-mystery-99", 1_000_000, 1_000_000) == 0.0


def test_drain_usage_starts_empty():
    # Drain may carry over from earlier test calls; once drained, it's empty.
    ai.drain_usage()
    assert ai.drain_usage() == []
