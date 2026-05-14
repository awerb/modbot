"""Integration tests against a real Postgres. Set TEST_DATABASE_URL to enable.

Example:
    TEST_DATABASE_URL=postgresql://u:p@localhost:5432/modbot_test pytest tests/test_routes.py
"""
import pytest


pytestmark = pytest.mark.needs_db


def test_health(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_seed_creates_group_and_members(client):
    # Startup hook should have seeded
    r = client.get("/chat/members")
    assert r.status_code == 200
    data = r.json()
    assert data["group_name"] == "YGL: Difficult Conversations"
    names = sorted(m["display_name"] for m in data["members"])
    assert names == sorted([
        "Amara Okonkwo",
        "Michael Standup",
        "Mei Lin",
        "Rafael Cardozo",
        "Priya Anand",
    ])


def test_seed_messages_present(client):
    r = client.get("/chat/messages")
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert len(msgs) >= 40
    # Order is ascending by received_at
    for a, b in zip(msgs, msgs[1:]):
        assert a["received_at"] <= b["received_at"]


def test_forwarded_seed_messages_held(client):
    r = client.get("/chat/messages")
    msgs = r.json()["messages"]
    forwarded = [m for m in msgs if m["is_forwarded"]]
    assert len(forwarded) >= 2
    for m in forwarded:
        assert m["forward_friction_status"] == "held"


def test_simulate_message_creates_with_analysis(client):
    members = client.get("/chat/members").json()["members"]
    mem_id = members[0]["id"]
    r = client.post(
        "/test/simulate-message",
        json={"member_id": mem_id, "text": "Test message about Gaza policy.", "is_forwarded": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["message_id"]
    assert body["analysis_id"]


def test_simulate_message_rejects_unknown_member(client):
    r = client.post(
        "/test/simulate-message",
        json={"member_id": "nonexistent", "text": "Hi", "is_forwarded": False},
    )
    assert r.status_code == 404


def test_dashboard_shape(client):
    r = client.get("/dashboard/data")
    assert r.status_code == 200
    d = r.json()
    assert "group" in d
    assert "member_tiles" in d
    assert len(d["member_tiles"]) == 5
    assert "group_state" in d
    gs = d["group_state"]
    for k in ("rolling_heat", "question_assertion_ratio_7d", "repair_count_week"):
        assert k in gs
    assert "alerts" in d
    assert "topics" in d
    assert "held_forwards" in d
    assert "targeted_messages" in d


def test_member_tile_phase2_fields(client):
    d = client.get("/dashboard/data").json()
    tile = d["member_tiles"][0]
    for k in ("repair_count", "steelman_count", "exit_flag", "share_week", "out_of_band"):
        assert k in tile


def test_backfill_status(client):
    r = client.get("/backfill/status")
    assert r.status_code == 200
    s = r.json()
    assert s["total"] >= 40
    assert s["pending"] >= 0
    assert s["analyzed"] == s["total"] - s["pending"]


def test_admin_reseed_open_when_token_unset(client):
    r = client.post("/admin/reseed")
    assert r.status_code == 200


def test_admin_reseed_gated_when_token_set(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret-x")
    r = client.post("/admin/reseed")
    assert r.status_code == 401
    r = client.post("/admin/reseed", headers={"X-Admin-Token": "secret-x"})
    assert r.status_code == 200


def test_alerts_endpoint(client):
    r = client.get("/alerts")
    assert r.status_code == 200
    assert "alerts" in r.json()


def test_resolve_unknown_alert(client):
    r = client.post("/alerts/nope/resolve")
    assert r.status_code == 404


def test_webhook_accepts_arbitrary_payload(client):
    r = client.post("/webhook/evolution", json={"event": "anything"})
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_chat_messages_includes_analysis_after_simulate(client):
    members = client.get("/chat/members").json()["members"]
    mem_id = members[0]["id"]
    client.post(
        "/test/simulate-message",
        json={"member_id": mem_id, "text": "Sample for analysis.", "is_forwarded": False},
    )
    r = client.get("/chat/messages")
    msgs = r.json()["messages"]
    # At least the seeded + new message
    assert len(msgs) >= 41
    # Newest should have analysis populated (synchronous run)
    newest = msgs[-1]
    assert newest["analysis"] is not None
    # Phase 2 fields exposed (may be None in stub mode but key should exist)
    assert "heat_score" in newest["analysis"]
    assert "is_repair" in newest["analysis"]
