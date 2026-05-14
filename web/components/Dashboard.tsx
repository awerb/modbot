"use client";
import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { jget, jpost } from "@/lib/api";

type Tile = {
  id: string;
  display_name: string;
  archetype: string;
  avatar_color: string;
  avatar_initial: string;
  word_count_today: number;
  word_count_week: number;
  share_today: number;
  share_week: number;
  out_of_band: boolean;
};

type DashData = {
  group: { id: string; name: string };
  today_message_count: number;
  member_tiles: Tile[];
  held_forwards: Array<{
    id: string;
    text: string;
    received_at: string;
    member: { display_name: string; avatar_color: string; avatar_initial: string };
  }>;
  targeted_messages: Array<{
    id: string;
    text: string;
    category: string | null;
    notes: string;
    member: { display_name: string; avatar_color: string; avatar_initial: string };
  }>;
  topics: Array<{ tag: string; count: number }>;
  yesterday_artifact: { date: string; summary: string; suggested_question: string } | null;
};

export default function Dashboard({
  refreshKey,
  onConnection,
}: {
  refreshKey: number;
  onConnection?: (ok: boolean) => void;
}) {
  const [data, setData] = useState<DashData | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await jget(`/dashboard/data`);
      setData(r);
      setLoadError(null);
      onConnection?.(true);
    } catch (e: any) {
      setLoadError(e?.message || "load failed");
      onConnection?.(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [refreshKey]);

  async function regenerate() {
    setBusy(true);
    try {
      await jpost(`/daily/generate`, {});
      await load();
    } finally {
      setBusy(false);
    }
  }

  function copyQuestion() {
    if (!data?.yesterday_artifact?.suggested_question) return;
    navigator.clipboard.writeText(data.yesterday_artifact.suggested_question);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm gap-2 p-4 text-center">
        <div>Loading dashboard…</div>
        {loadError && (
          <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-xs">
            {loadError}. Retrying every 3s.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="bg-forest text-white px-4 py-3">
        <div className="text-xs uppercase tracking-wider opacity-80">YGL Mod</div>
        <div className="font-semibold">{data.group.name}</div>
        <div className="text-xs opacity-80">{data.today_message_count} messages today</div>
      </div>

      {/* Member tiles */}
      <Section title="Floor balance (last 7d)">
        <div className="grid grid-cols-1 gap-2">
          {data.member_tiles.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 rounded-md border p-2 bg-white ${
                t.out_of_band ? "border-amber-400" : "border-gray-200"
              }`}
            >
              <Avatar initial={t.avatar_initial} color={t.avatar_color} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.display_name}</div>
                <div className="text-[11px] text-gray-500 truncate">{t.archetype}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{Math.round(t.share_week * 100)}%</div>
                <div className="text-[10px] text-gray-500">{t.word_count_week} words</div>
              </div>
              {t.out_of_band && (
                <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                  out of band
                </span>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Suggested question */}
      <Section title="Today's suggested question">
        {data.yesterday_artifact?.suggested_question ? (
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="text-sm text-gray-900 whitespace-pre-wrap">
              {data.yesterday_artifact.suggested_question}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={regenerate}
                disabled={busy}
                className="text-xs rounded bg-forest text-white px-2.5 py-1 disabled:opacity-50"
              >
                {busy ? "Working…" : "Regenerate"}
              </button>
              <button
                onClick={copyQuestion}
                className="text-xs rounded border border-gray-300 px-2.5 py-1"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                className="text-xs rounded border border-gray-300 px-2.5 py-1 text-gray-500"
                title="not wired yet"
              >
                Send to group
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={regenerate}
            disabled={busy}
            className="text-xs rounded bg-forest text-white px-2.5 py-1"
          >
            {busy ? "Generating…" : "Generate"}
          </button>
        )}
      </Section>

      {/* Held forwards */}
      <Section title={`Held forwards (${data.held_forwards.length})`}>
        {data.held_forwards.length === 0 ? (
          <Empty>No held forwards.</Empty>
        ) : (
          <div className="space-y-2">
            {data.held_forwards.map((m) => (
              <div key={m.id} className="rounded-md border border-gray-200 bg-white p-2">
                <div className="flex items-center gap-2 mb-1">
                  <Avatar initial={m.member.avatar_initial} color={m.member.avatar_color} size={22} />
                  <div className="text-xs font-medium">{m.member.display_name}</div>
                  <div className="text-[10px] text-gray-400 ml-auto">↪ forwarded</div>
                </div>
                <div className="text-sm text-gray-800 line-clamp-3">{m.text}</div>
                <div className="mt-1 flex gap-2">
                  <button className="text-[11px] rounded border border-gray-300 px-2 py-0.5 text-gray-600">
                    Release
                  </button>
                  <button className="text-[11px] rounded border border-gray-300 px-2 py-0.5 text-gray-600">
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Targeted */}
      <Section title={`Targeted messages (${data.targeted_messages.length})`}>
        {data.targeted_messages.length === 0 ? (
          <Empty>No flagged messages.</Empty>
        ) : (
          <div className="space-y-2">
            {data.targeted_messages.map((m) => (
              <div key={m.id} className="rounded-md border border-red-200 bg-red-50 p-2">
                <div className="flex items-center gap-2 mb-1">
                  <Avatar initial={m.member.avatar_initial} color={m.member.avatar_color} size={22} />
                  <div className="text-xs font-medium">{m.member.display_name}</div>
                  {m.category && (
                    <span className="text-[10px] bg-red-200 text-red-800 rounded px-1.5 py-0.5">
                      {m.category}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-800">{m.text}</div>
                {m.notes && (
                  <div className="text-[11px] text-red-700 mt-1 italic">{m.notes}</div>
                )}
                <div className="mt-1 flex gap-2">
                  <button className="text-[11px] rounded border border-red-300 bg-white px-2 py-0.5 text-red-700">
                    Approve flag
                  </button>
                  <button className="text-[11px] rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-600">
                    Override
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Topics */}
      <Section title="Topics in play">
        {data.topics.length === 0 ? (
          <Empty>No topics detected yet.</Empty>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.topics.map((t) => (
              <span
                key={t.tag}
                className="text-[11px] rounded-full bg-white border border-gray-200 px-2 py-0.5"
              >
                {t.tag} <span className="text-gray-400">· {t.count}</span>
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Yesterday summary */}
      <Section title="Yesterday's summary">
        {data.yesterday_artifact?.summary ? (
          <div className="rounded-md border border-gray-200 bg-white p-3 text-sm whitespace-pre-wrap text-gray-800">
            {data.yesterday_artifact.summary}
          </div>
        ) : (
          <div className="space-y-2">
            <Empty>No summary yet.</Empty>
            <button
              onClick={regenerate}
              disabled={busy}
              className="text-xs rounded bg-forest text-white px-2.5 py-1 disabled:opacity-50"
            >
              {busy ? "Generating…" : "Generate yesterday's summary"}
            </button>
          </div>
        )}
      </Section>

      <div className="px-4 py-3 text-[10px] text-gray-400">
        Phase 1 demo · auto-refresh every 3s
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-gray-200">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-gray-400 italic">{children}</div>;
}
