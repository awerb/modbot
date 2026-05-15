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
  repair_count: number;
  steelman_count: number;
  exit_flag: boolean;
};

type Alert = {
  id: string;
  kind: string;
  payload: any;
  created_at: string;
};

type DashData = {
  group: { id: string; name: string };
  today_message_count: number;
  group_state: {
    rolling_heat: number;
    question_assertion_ratio_7d: number;
    repair_count_week: number;
  };
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
  personal_events: Array<{
    id: string;
    text: string;
    notes: string | null;
    member: { display_name: string; avatar_color: string; avatar_initial: string };
  }>;
  topics: Array<{ tag: string; count: number }>;
  yesterday_artifact: { date: string; summary: string; suggested_question: string } | null;
  alerts: Alert[];
};

const ALERT_LABEL: Record<string, string> = {
  pause_suggested: "Pause suggested",
  steelman_missing: "Steelman missing",
  repair_detected: "Repair detected",
  exit_velocity: "Exit velocity risk",
  quiet_member_substantive: "Quiet member contributed",
};

const ALERT_COLOR: Record<string, string> = {
  pause_suggested: "bg-orange-50 border-orange-300 text-orange-800",
  steelman_missing: "bg-yellow-50 border-yellow-300 text-yellow-800",
  repair_detected: "bg-emerald-50 border-emerald-300 text-emerald-800",
  exit_velocity: "bg-rose-50 border-rose-300 text-rose-800",
  quiet_member_substantive: "bg-sky-50 border-sky-300 text-sky-800",
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
  const [backfillPending, setBackfillPending] = useState(0);

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
    try {
      const s = await jget(`/backfill/status`);
      setBackfillPending(s.pending ?? 0);
    } catch {}
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

  async function resolveAlert(id: string) {
    try {
      await jpost(`/alerts/${id}/resolve`, {});
      await load();
    } catch {}
  }

  async function forwardAction(messageId: string, action: "release" | "discard") {
    try {
      await jpost(`/forwards/${messageId}/${action}`, {});
      await load();
    } catch {}
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

  const gs = data.group_state;
  const heat = gs.rolling_heat;
  const heatColor = heat >= 0.65 ? "bg-red-500" : heat >= 0.45 ? "bg-orange-400" : heat >= 0.25 ? "bg-yellow-300" : "bg-emerald-400";

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="bg-forest text-white px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wider opacity-80">YGL Mod</div>
            <div className="font-semibold">{data.group.name}</div>
            <div className="text-xs opacity-80">{data.today_message_count} messages today</div>
          </div>
          {backfillPending > 0 && (
            <span className="text-[10px] bg-white/20 text-white rounded-full px-2 py-0.5 self-center" title="Analysis backlog">
              Analyzing {backfillPending}…
            </span>
          )}
        </div>
      </div>

      {/* Phase 2 top strip */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Heat" value={heat.toFixed(2)} hint="last 5 msgs">
            <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
              <div className={`${heatColor} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(100, heat * 100)}%` }} />
            </div>
          </Metric>
          <Metric label="Q / A" value={gs.question_assertion_ratio_7d.toFixed(2)} hint="7d ratio">
            <div className={`text-[10px] mt-1 ${gs.question_assertion_ratio_7d < 0.2 ? "text-amber-700" : "text-gray-400"}`}>
              {gs.question_assertion_ratio_7d < 0.2 ? "low: assertion-heavy" : "ok"}
            </div>
          </Metric>
          <Metric label="Repairs" value={String(gs.repair_count_week)} hint="this week">
            <div className="text-[10px] mt-1 text-emerald-700">
              {gs.repair_count_week > 0 ? "✓ momentum" : "—"}
            </div>
          </Metric>
        </div>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <Section title={`Moderator alerts (${data.alerts.length})`}>
          <div className="space-y-2">
            {data.alerts.map((a) => (
              <div key={a.id} className={`rounded-md border p-2 ${ALERT_COLOR[a.kind] || "bg-gray-50 border-gray-200 text-gray-700"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold">{ALERT_LABEL[a.kind] || a.kind}</div>
                  <button onClick={() => resolveAlert(a.id)} className="text-[10px] underline opacity-80 hover:opacity-100">dismiss</button>
                </div>
                {a.payload?.member && (
                  <div className="text-[11px] opacity-80">{a.payload.member}</div>
                )}
                {a.payload?.text_snippet && (
                  <div className="text-[12px] mt-0.5 italic line-clamp-2">"{a.payload.text_snippet}"</div>
                )}
                {a.payload?.draft && (
                  <div className="text-[12px] mt-1 bg-white/60 rounded p-1.5 whitespace-pre-wrap">{a.payload.draft}</div>
                )}
                {a.payload?.notes && (
                  <div className="text-[11px] mt-0.5">{a.payload.notes}</div>
                )}
                {a.kind === "exit_velocity" && a.payload?.silent_hours && (
                  <div className="text-[11px] mt-0.5">Silent for {a.payload.silent_hours}h after contested exchange</div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Member tiles */}
      <Section title="Floor balance (last 7d)">
        <div className="grid grid-cols-1 gap-2">
          {data.member_tiles.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2.5 rounded-md border p-2 bg-white ${
                t.exit_flag ? "border-rose-400" : t.out_of_band ? "border-amber-400" : "border-gray-200"
              }`}
            >
              <Avatar initial={t.avatar_initial} color={t.avatar_color} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.display_name}</div>
                <div className="text-[11px] text-gray-500 truncate">{t.archetype}</div>
                <div className="text-[10px] mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {t.repair_count > 0 && (
                    <span className="text-emerald-700" title="repairs (apologies / acknowledgements)">★ {t.repair_count}</span>
                  )}
                  {t.steelman_count > 0 && (
                    <span className="text-sky-700" title="steelmans (acknowledging the other view first)">⚖ {t.steelman_count}</span>
                  )}
                  {t.exit_flag && (
                    <span className="text-rose-700" title="exit velocity: contested + 48h silence">⚠ exit risk</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{Math.round(t.share_week * 100)}%</div>
                <div className="text-[10px] text-gray-500">{t.word_count_week} words</div>
              </div>
              {t.out_of_band && !t.exit_flag && (
                <span className="text-[10px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                  off band
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
                  <button
                    onClick={() => forwardAction(m.id, "release")}
                    className="text-[11px] rounded border border-emerald-300 bg-white hover:bg-emerald-50 px-2 py-0.5 text-emerald-800"
                  >
                    Release
                  </button>
                  <button
                    onClick={() => forwardAction(m.id, "discard")}
                    className="text-[11px] rounded border border-gray-300 bg-white hover:bg-gray-50 px-2 py-0.5 text-gray-700"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

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
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Personal events flagged (${data.personal_events?.length ?? 0})`}>
        {!data.personal_events || data.personal_events.length === 0 ? (
          <Empty>No off-topic personal posts.</Empty>
        ) : (
          <div className="space-y-2">
            {data.personal_events.map((m) => (
              <div key={m.id} className="rounded-md border border-violet-200 bg-violet-50 p-2">
                <div className="flex items-center gap-2 mb-1">
                  <Avatar initial={m.member.avatar_initial} color={m.member.avatar_color} size={22} />
                  <div className="text-xs font-medium">{m.member.display_name}</div>
                  <span className="text-[10px] bg-violet-200 text-violet-800 rounded px-1.5 py-0.5">
                    personal
                  </span>
                </div>
                <div className="text-sm text-gray-800">{m.text}</div>
                {m.notes && (
                  <div className="text-[11px] text-violet-700 mt-1 italic">{m.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

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
        Phase 2 demo · auto-refresh every 3s · sonnet-4-5 + haiku-4-5
      </div>
    </div>
  );
}

function Metric({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
      </div>
      {children}
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
