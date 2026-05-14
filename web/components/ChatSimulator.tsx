"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { jget, jpost } from "@/lib/api";

type Member = {
  id: string;
  display_name: string;
  archetype: string;
  avatar_color: string;
  avatar_initial: string;
};

type Msg = {
  id: string;
  text: string;
  is_forwarded: boolean;
  received_at: string;
  source: string;
  member: Member;
  analysis?: {
    target_flag: boolean;
    target_category?: string | null;
    has_unsourced_claim: boolean;
    topic_tags: string[];
    factuality_notes?: string | null;
    target_notes?: string | null;
    heat_score?: number | null;
    is_disagreement?: boolean;
    steelman_present?: boolean;
    is_question?: boolean;
    is_repair?: boolean;
    repair_notes?: string | null;
  } | null;
  _optimistic?: boolean;
};

type PauseBanner = { draft: string; alertId: string } | null;

function timeLabel(iso: string) {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - that.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString();
}

export default function ChatSimulator({
  onUpdate,
  onConnection,
}: {
  onUpdate?: () => void;
  onConnection?: (ok: boolean) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [optimistic, setOptimistic] = useState<Msg[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [forwarded, setForwarded] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pauseBanner, setPauseBanner] = useState<PauseBanner>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  async function loadMembers() {
    try {
      const r = await jget(`/chat/members`);
      setMembers(r.members);
      setGroupName(r.group_name);
      setActive((prev) => prev || (r.members[0]?.id ?? null));
      onConnection?.(true);
    } catch (e) {
      onConnection?.(false);
    }
  }

  async function loadMessages() {
    try {
      const r = await jget(`/chat/messages`);
      const serverMsgs: Msg[] = r.messages;
      setMessages(serverMsgs);
      // Drop optimistic messages whose server twin has arrived
      setOptimistic((opt) => {
        if (opt.length === 0) return opt;
        const serverByKey = new Set(
          serverMsgs.map((m) => `${m.member.id}|${m.text}`)
        );
        return opt.filter((o) => !serverByKey.has(`${o.member.id}|${o.text}`));
      });
      // Clear pending IDs for messages that now have an analysis
      setPendingIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const m of serverMsgs) {
          if (m.analysis && next.has(m.id)) next.delete(m.id);
        }
        return next;
      });
      onConnection?.(true);
    } catch (e) {
      onConnection?.(false);
    }
  }

  async function loadPauseAlert() {
    try {
      const r = await jget(`/alerts`);
      const pause = (r.alerts || []).find((a: any) => a.kind === "pause_suggested");
      if (pause) setPauseBanner({ draft: pause.payload?.draft || "Things look heated. Consider pausing.", alertId: pause.id });
      else setPauseBanner(null);
    } catch {}
  }

  useEffect(() => {
    loadMembers();
    loadMessages();
    loadPauseAlert();
    const t = setInterval(() => {
      loadMessages();
      loadPauseAlert();
    }, 2500);
    return () => clearInterval(t);
  }, []);

  async function dismissPause() {
    if (!pauseBanner) return;
    try {
      await jpost(`/alerts/${pauseBanner.alertId}/resolve`, {});
      setPauseBanner(null);
    } catch {}
  }

  // Auto-scroll only when user was already near the bottom
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, optimistic.length, pendingIds.size]);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distFromBottom < 80;
  }

  const activeMember = useMemo(
    () => members.find((m) => m.id === active) || null,
    [members, active]
  );

  async function send() {
    if (!text.trim() || !active || !activeMember) return;
    setSending(true);
    setError(null);
    const sentText = text.trim();
    const sentForwarded = forwarded;
    setText("");
    setForwarded(false);
    stickToBottom.current = true;

    // Optimistic insert
    const tempId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const opt: Msg = {
      id: tempId,
      text: sentText,
      is_forwarded: sentForwarded,
      received_at: new Date().toISOString(),
      source: "simulated",
      member: activeMember,
      analysis: null,
      _optimistic: true,
    };
    setOptimistic((prev) => [...prev, opt]);
    setPendingIds((p) => {
      const n = new Set(p);
      n.add(tempId);
      return n;
    });

    try {
      const r = await jpost(
        `/test/simulate-message`,
        { member_id: active, text: sentText, is_forwarded: sentForwarded },
        { timeoutMs: 45000 }
      );
      if (r?.message_id) {
        // Transfer "pending" from the optimistic temp ID to the real server ID
        setPendingIds((p) => {
          const n = new Set(p);
          n.delete(tempId);
          n.add(r.message_id);
          return n;
        });
      }
      await loadMessages();
      onUpdate?.();
    } catch (e: any) {
      setError(e?.message || "send failed");
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      setPendingIds((p) => {
        const n = new Set(p);
        n.delete(tempId);
        return n;
      });
      setText(sentText);
      setForwarded(sentForwarded);
    } finally {
      setSending(false);
    }
  }

  // Combined timeline: server messages followed by any still-pending optimistics
  const combined = [...messages, ...optimistic];

  // Group day-dividers
  const grouped: { day: string; items: Msg[] }[] = [];
  let curDay = "";
  for (const m of combined) {
    const dl = dayLabel(m.received_at);
    if (dl !== curDay) {
      curDay = dl;
      grouped.push({ day: dl, items: [m] });
    } else {
      grouped[grouped.length - 1].items.push(m);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-wa-header text-white px-4 py-3 flex items-center gap-3">
        <div className="flex -space-x-2">
          {members.slice(0, 4).map((m) => (
            <Avatar key={m.id} initial={m.avatar_initial} color={m.avatar_color} size={28} />
          ))}
        </div>
        <div className="flex-1">
          <div className="font-semibold">{groupName || "Loading..."}</div>
          <div className="text-xs opacity-80">{members.length} members</div>
        </div>
        <div className="text-xs opacity-80">Simulator</div>
      </div>

      {/* Pause-suggested banner */}
      {pauseBanner && (
        <div className="bg-orange-50 border-b border-orange-300 px-3 py-2 text-[12px] text-orange-900 flex items-start gap-2">
          <div className="text-orange-600 mt-0.5">⏸</div>
          <div className="flex-1">
            <div className="font-semibold text-[11px] uppercase tracking-wider">Pause suggested</div>
            <div className="mt-0.5 whitespace-pre-wrap">{pauseBanner.draft}</div>
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => {
                navigator.clipboard.writeText(pauseBanner.draft);
              }}
              className="text-[11px] rounded border border-orange-400 bg-white px-2 py-0.5 text-orange-900"
            >
              Copy
            </button>
            <button
              onClick={dismissPause}
              className="text-[11px] rounded border border-orange-300 bg-white px-2 py-0.5 text-orange-700"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto wa-bg px-4 py-3 space-y-1"
      >
        {combined.length === 0 && (
          <div className="text-center text-xs text-gray-500 py-8">
            No messages yet. Pick a character and post something.
          </div>
        )}
        {grouped.map((g, gi) => (
          <div key={gi}>
            <div className="flex justify-center my-2">
              <div className="text-[11px] bg-white/70 text-gray-700 rounded-md px-2 py-0.5 shadow-sm">
                {g.day}
              </div>
            </div>
            {g.items.map((m) => {
              const own = m.member.id === active;
              const isPending = pendingIds.has(m.id) && !m.analysis;
              const a = m.analysis;
              const hasNotes = !!(a && (a.target_notes || a.factuality_notes));
              const isExpanded = expanded.has(m.id);
              const showWhy = hasNotes && (a?.target_flag || a?.has_unsourced_claim);
              return (
                <div
                  key={m.id}
                  className={`flex ${own ? "justify-end" : "justify-start"} mb-1.5`}
                >
                  {!own && (
                    <div className="mr-1.5 self-end">
                      <Avatar initial={m.member.avatar_initial} color={m.member.avatar_color} size={28} />
                    </div>
                  )}
                  <div
                    className={`max-w-[78%] rounded-lg px-2.5 py-1.5 bubble-shadow ${
                      own ? "bg-wa-out" : "bg-white"
                    } ${m._optimistic ? "opacity-70" : ""}`}
                  >
                    {!own && (
                      <div
                        className="text-[12px] font-semibold mb-0.5"
                        style={{ color: m.member.avatar_color }}
                      >
                        {m.member.display_name}
                      </div>
                    )}
                    {m.is_forwarded && (
                      <div className="text-[11px] text-gray-500 italic mb-0.5 flex items-center gap-1">
                        <span>↪</span> Forwarded
                      </div>
                    )}
                    <div className="text-[14px] text-gray-900 whitespace-pre-wrap leading-snug">
                      {m.text}
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-0.5 flex-wrap">
                      {a?.is_repair && (
                        <span className="text-[10px] text-emerald-700" title={a.repair_notes || "repair detected"}>★</span>
                      )}
                      {a?.is_disagreement && !a?.steelman_present && (a?.heat_score || 0) >= 0.4 && (
                        <span className="text-[10px] text-yellow-700" title="disagreement without steelman">⚠</span>
                      )}
                      {a?.is_question && (
                        <span className="text-[10px] text-sky-700" title="question">?</span>
                      )}
                      {(a?.heat_score || 0) >= 0.65 && (
                        <span className="text-[10px] bg-orange-100 text-orange-800 rounded px-1.5 py-0.5" title={`heat ${a?.heat_score?.toFixed(2)}`}>
                          🔥 hot
                        </span>
                      )}
                      {a?.target_flag && (
                        <button
                          onClick={() => toggleExpand(m.id)}
                          className="text-[10px] bg-red-100 hover:bg-red-200 text-red-700 rounded px-1.5 py-0.5"
                          title={a.target_category ? `category: ${a.target_category}` : "flagged"}
                        >
                          flagged{a.target_category ? ` · ${a.target_category}` : ""}
                        </button>
                      )}
                      {a?.has_unsourced_claim && (
                        <button
                          onClick={() => toggleExpand(m.id)}
                          className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-800 rounded px-1.5 py-0.5"
                        >
                          unsourced
                        </button>
                      )}
                      {isPending && (
                        <span className="text-[10px] bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">
                          Analyzing…
                        </span>
                      )}
                      {m._optimistic && !isPending && (
                        <span className="text-[10px] text-gray-400">sending…</span>
                      )}
                      <span className="text-[10px] text-gray-500">{timeLabel(m.received_at)}</span>
                    </div>
                    {showWhy && isExpanded && (
                      <div className="mt-1.5 pt-1.5 border-t border-gray-200 text-[11px] text-gray-700 space-y-1">
                        {a?.target_flag && a?.target_notes && (
                          <div>
                            <span className="font-semibold text-red-700">Targeting: </span>
                            {a.target_notes}
                          </div>
                        )}
                        {a?.has_unsourced_claim && a?.factuality_notes && (
                          <div>
                            <span className="font-semibold text-amber-800">Claim: </span>
                            {a.factuality_notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Character switcher + input */}
      <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-gray-600 truncate">
            Posting as:{" "}
            <span className="font-semibold" style={{ color: activeMember?.avatar_color }}>
              {activeMember?.display_name || "—"}
            </span>{" "}
            {activeMember && (
              <span className="text-gray-400">· {activeMember.archetype}</span>
            )}
          </div>
          <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={forwarded}
              onChange={(e) => setForwarded(e.target.checked)}
            />
            forwarded
          </label>
        </div>
        <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => setActive(m.id)}
              title={`${m.display_name} · ${m.archetype}`}
              className="shrink-0"
            >
              <Avatar
                initial={m.avatar_initial}
                color={m.avatar_color}
                size={36}
                ring={m.id === active}
              />
            </button>
          ))}
        </div>
        {error && (
          <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button className="text-gray-400 hover:text-gray-600 text-xl px-1" title="attach (stub)">📎</button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message"
            className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wa-deep"
          />
          <button
            onClick={send}
            disabled={sending || !text.trim() || !active}
            className="rounded-full bg-wa-accent text-white w-11 h-11 flex items-center justify-center disabled:opacity-50 text-lg"
            title="Send"
          >
            {sending ? "…" : "➤"}
          </button>
        </div>
      </div>
    </div>
  );
}
