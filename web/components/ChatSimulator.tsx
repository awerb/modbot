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
  } | null;
};

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
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [forwarded, setForwarded] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  async function loadMembers() {
    try {
      const r = await jget(`/chat/members`);
      setMembers(r.members);
      setGroupName(r.group_name);
      setActive((prev) => prev || (r.members[0]?.id ?? null));
      onConnection?.(true);
    } catch (e: any) {
      onConnection?.(false);
    }
  }

  async function loadMessages() {
    try {
      const r = await jget(`/chat/messages`);
      setMessages(r.messages);
      // Clear pending IDs that now have an analysis
      setPendingIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const m of r.messages) {
          if (m.analysis && next.has(m.id)) next.delete(m.id);
        }
        return next;
      });
      onConnection?.(true);
    } catch (e: any) {
      onConnection?.(false);
    }
  }

  useEffect(() => {
    loadMembers();
    loadMessages();
    const t = setInterval(loadMessages, 2500);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll only when user was already near the bottom
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, pendingIds.size]);

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
    if (!text.trim() || !active) return;
    setSending(true);
    setError(null);
    const sentText = text.trim();
    const sentForwarded = forwarded;
    setText("");
    setForwarded(false);
    stickToBottom.current = true;
    try {
      const r = await jpost(
        `/test/simulate-message`,
        { member_id: active, text: sentText, is_forwarded: sentForwarded },
        { timeoutMs: 45000 }
      );
      if (r?.message_id) {
        setPendingIds((p) => {
          const n = new Set(p);
          n.add(r.message_id);
          return n;
        });
      }
      await loadMessages();
      onUpdate?.();
    } catch (e: any) {
      setError(e?.message || "send failed");
      // restore input so user doesn't lose it
      setText(sentText);
      setForwarded(sentForwarded);
    } finally {
      setSending(false);
    }
  }

  // Group day-dividers
  const grouped: { day: string; items: Msg[] }[] = [];
  let curDay = "";
  for (const m of messages) {
    const dl = dayLabel(m.received_at);
    if (dl !== curDay) {
      curDay = dl;
      grouped.push({ day: dl, items: [m] });
    } else {
      grouped[grouped.length - 1].items.push(m);
    }
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

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto wa-bg px-4 py-3 space-y-1"
      >
        {messages.length === 0 && (
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
                    }`}
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
                      {m.analysis?.target_flag && (
                        <span className="text-[10px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">
                          flagged
                        </span>
                      )}
                      {m.analysis?.has_unsourced_claim && (
                        <span className="text-[10px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                          unsourced
                        </span>
                      )}
                      {isPending && (
                        <span className="text-[10px] bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">
                          Analyzing…
                        </span>
                      )}
                      <span className="text-[10px] text-gray-500">{timeLabel(m.received_at)}</span>
                    </div>
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
            className="rounded-full bg-wa-accent text-white w-10 h-10 flex items-center justify-center disabled:opacity-50"
            title="Send"
          >
            {sending ? "…" : "➤"}
          </button>
        </div>
      </div>
    </div>
  );
}
