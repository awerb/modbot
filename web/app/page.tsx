"use client";
import { useState } from "react";
import ChatSimulator from "@/components/ChatSimulator";
import Dashboard from "@/components/Dashboard";
import AboutTab from "@/components/AboutTab";
import UsagePill from "@/components/UsagePill";
import { jpost, getAdminToken, setAdminToken } from "@/lib/api";

const ARCHETYPES: { initial: string; color: string; name: string; tag: string; line: string }[] = [
  { initial: "A", color: "#0ea5e9", name: "Amara Okonkwo", tag: "Bridge-Builder", line: "Asks questions, summarizes, steelmans before disagreeing." },
  { initial: "M", color: "#dc2626", name: "Michael Standup", tag: "Provocateur", line: "Forwards articles, drops stats without sources, tends to absolutes." },
  { initial: "L", color: "#16a34a", name: "Mei Lin", tag: "Quiet Expert", line: "Posts rarely but with sourced, careful long-form takes." },
  { initial: "R", color: "#f59e0b", name: "Rafael Cardozo", tag: "Personal-Stakes Voice", line: "Brings lived experience; pushes back when others abstract." },
  { initial: "P", color: "#8b5cf6", name: "Priya Anand", tag: "Strident Voice", line: "Names harm directly, emotional, takes the opposite position to Michael." },
];

type Rule = { code: string; name: string; status: "live" | "soon"; logic: string };

const RULES: Rule[] = [
  { code: "R1", name: "Floor balance", status: "live", logic: "Per-member word share over rolling 7d. Flag any member outside 10–40%. Surfaces members being talked over and members dominating." },
  { code: "R2", name: "Steelman", status: "live", logic: "When a message is classified as disagreement, check if the speaker first acknowledged the other view. If not, and the message is hot (≥0.4), emit a steelman_missing alert with a yellow icon on the message." },
  { code: "R3", name: "Heat + pause", status: "live", logic: "Each message gets a 0–1 heat score from Sonnet (intensity, not topic). Rolling average over last 5. If the last 3 messages each score ≥0.65, emit pause_suggested with a Sonnet-drafted pause message. 30-min cooldown between firings." },
  { code: "R5", name: "Hold forwards for review", status: "live", logic: "Forwarded content (articles, screenshots, stats from elsewhere) is intercepted and surfaced in a separate panel on the dashboard. The moderator releases or drops it. Stops the group from spending half an hour arguing about a chart nobody can find the source for." },
  { code: "R6", name: "Target vs topic", status: "live", logic: "Targeting language is flagged separately from topic chips. The Sonnet prompt is given worked examples so quoting language to push back is NOT flagged as targeting, while actually demeaning a group IS." },
  { code: "R7", name: "Question / Assertion ratio", status: "live", logic: "Rolling 7-day count of question messages over assertion messages. Below ~0.2 = assertion-heavy debate. Soft warning on the dashboard, no alert." },
  { code: "R8", name: "Quiet-member reward", status: "live", logic: "Member with <10% week share who posts a substantive (≥25-word) message in the last 24h emits a quiet_member_substantive alert and gets referenced by name in tomorrow's suggested question." },
  { code: "R9", name: "Repair detection", status: "live", logic: "Apologies, walk-backs, acknowledging harm, thanking for a correction. Generously detected by Sonnet. Green star on the message, increments member's repair_count, emits a repair_detected alert. Repair is the most important signal in a healthy thread." },
  { code: "R10", name: "Exit velocity", status: "live", logic: "Member had a contested exchange (heat ≥0.5 or disagreement) in the last 7d AND has been silent for ≥48h. Emits exit_velocity alert visible only to the moderator. The window where someone is about to leave the group quietly." },
];

type RoadmapItem = { status: "done" | "next" | "later"; title: string; line: string };

const ROADMAP: RoadmapItem[] = [
  // Phase 1
  { status: "done", title: "Chat simulator + dashboard", line: "WhatsApp-style chat with 5 archetype characters, optimistic send, click-to-expand AI reasoning. Forest-green moderator dashboard with floor balance, held forwards, targeted flags, topics, daily summary." },
  { status: "done", title: "AI analysis pipeline", line: "Factuality / source check (Haiku), targeting check (Sonnet with worked examples for quoting vs. using language), deep classification (Sonnet)." },
  { status: "done", title: "Rules R1, R5, R6", line: "Floor balance, forward friction, target-vs-topic separation." },
  { status: "done", title: "Daily summary + suggested question", line: "Sonnet generates a neutral 4–6 bullet summary and a single seed question that references quiet members by name." },
  // Phase 2
  { status: "done", title: "Heat, steelman, repair, exit velocity", line: "Rules R2, R3, R9, R10 with moderator alerts. Pause-suggested banner with Sonnet-drafted pause message ready to paste." },
  { status: "done", title: "Q/A ratio + quiet-member reward", line: "Rules R7, R8. Rolling 7d ratio in the dashboard top strip, quiet-member alert and tomorrow's-question integration." },
  { status: "done", title: "Hardening", line: "Admin endpoints token-gated, 7d cap on flagged lists, graceful API fallback when no Anthropic key, optimistic send, AI timeouts." },
  { status: "done", title: "Tests + docs", line: "Pytest suite (18 unit + 15 integration), TypeScript clean, README + ARCHITECTURE + CHANGELOG." },
  // Phase 3
  { status: "next", title: "Evolution API webhook (real WhatsApp)", line: "Wire /webhook/evolution to a live WhatsApp instance, dedupe by message_id, persist raw_payload." },
  { status: "next", title: "Outbound: moderator-approved sends", line: "Approved pause prompts and steelman invitations get posted back to the group with a moderator byline. Always human-approved, never auto-send." },
  { status: "next", title: "Multi-group support", line: "One moderator, several pilots. Group switcher in the top bar, group_id scoping already in place server-side." },
  { status: "next", title: "Member consent and opt-in flow", line: "Members get a one-time disclosure about what's analyzed and what's stored, plus a way to opt out of specific signals (e.g. heat scoring)." },
  { status: "next", title: "Background analysis (don't block sends)", line: "Move the 3 AI calls out of the simulate-message request path. Return the message_id immediately, let polling fill in the analysis. Avoids 45s-timeout edge cases." },
  // Phase 4
  { status: "later", title: "Per-member tone calibration", line: "Heat scored relative to each member's baseline, not absolute. Some members are dispassionate by default, some are intense, both are healthy." },
  { status: "later", title: "Thread coherence", line: "Detect when a debate is talking past itself vs. closing in on a real disagreement. Hard. Probably structured + LLM hybrid." },
  { status: "later", title: "Source attestation library", line: "Track which sources have been credibly used in the group and which have been debunked in-thread. Speeds up factuality_check and gives the moderator continuity." },
  { status: "later", title: "Daily moderator email digest", line: "Everything the dashboard shows, plus suggested 1:1 follow-ups (e.g. who looks like they're about to disengage)." },
];

type Tab = "demo" | "about";

export default function Page() {
  const [tab, setTab] = useState<Tab>("demo");
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOk, setChatOk] = useState<boolean | null>(null);
  const [dashOk, setDashOk] = useState<boolean | null>(null);
  const [resetting, setResetting] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);

  function togglePanel(name: "legend" | "rules" | "roadmap") {
    // The three reference panels live on the demo tab. If the user is on About,
    // hop back to demo so the panel is visible.
    if (tab !== "demo") setTab("demo");
    setLegendOpen(name === "legend" ? !legendOpen : false);
    setRulesOpen(name === "rules" ? !rulesOpen : false);
    setRoadmapOpen(name === "roadmap" ? !roadmapOpen : false);
  }

  const bumpDashboard = () => setRefreshKey((k) => k + 1);

  const connected =
    chatOk === null && dashOk === null
      ? null
      : chatOk !== false && dashOk !== false;

  async function resetDemo() {
    if (!confirm("Wipe and reseed the demo data?")) return;
    setResetting(true);
    try {
      try {
        await jpost(`/admin/reseed`, {});
      } catch (e: any) {
        if (/401/.test(String(e?.message || ""))) {
          const t = prompt("Admin token required (ADMIN_TOKEN env var on the api). Enter it:", getAdminToken() || "");
          if (!t) {
            return;
          }
          setAdminToken(t);
          await jpost(`/admin/reseed`, {});
        } else {
          throw e;
        }
      }
      bumpDashboard();
    } catch (e) {
      alert("Reset failed. Is the API up?");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-md bg-forest text-white font-bold flex items-center justify-center">
            Y
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">YGL Mod</div>
            <div className="text-[11px] text-gray-500 leading-tight">moderation tool</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setTab(tab === "about" ? "demo" : "about")}
            className={`text-xs rounded border px-2 py-1 ${tab === "about" ? "border-forest bg-forest/5 text-forest" : "border-gray-300 hover:bg-gray-50"}`}
            title="Technical description of what's built"
          >
            About
          </button>
          <button
            onClick={() => togglePanel("legend")}
            className={`text-xs rounded border px-2 py-1 ${legendOpen ? "border-forest bg-forest/5 text-forest" : "border-gray-300 hover:bg-gray-50"}`}
            title="Who are these characters?"
          >
            Who's who
          </button>
          <button
            onClick={() => togglePanel("rules")}
            className={`text-xs rounded border px-2 py-1 ${rulesOpen ? "border-forest bg-forest/5 text-forest" : "border-gray-300 hover:bg-gray-50"}`}
            title="What rules drive the moderation signals?"
          >
            Moderation rules
          </button>
          <button
            onClick={() => togglePanel("roadmap")}
            className={`text-xs rounded border px-2 py-1 ${roadmapOpen ? "border-forest bg-forest/5 text-forest" : "border-gray-300 hover:bg-gray-50"}`}
            title="What's done and what's planned"
          >
            Roadmap
          </button>
          <UsagePill />
          <span
            className={`text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full border ${
              connected === false
                ? "border-red-300 text-red-700 bg-red-50"
                : connected
                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                  : "border-gray-300 text-gray-500 bg-gray-50"
            }`}
            title="API connection"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected === false
                  ? "bg-red-500"
                  : connected
                    ? "bg-emerald-500"
                    : "bg-gray-400"
              }`}
            />
            {connected === false ? "offline" : connected ? "online" : "..."}
          </span>
          {tab === "demo" && (
            <>
              <button
                onClick={resetDemo}
                disabled={resetting}
                className="text-xs rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
                title="Wipe and reseed the demo data"
              >
                {resetting ? "Resetting…" : "Reset demo"}
              </button>
              <button
                onClick={() => setDrawerOpen(true)}
                className="md:hidden text-xs rounded border border-gray-300 px-2 py-1"
              >
                Dashboard
              </button>
            </>
          )}
        </div>
      </div>

      {/* Archetype legend */}
      {tab === "demo" && legendOpen && (
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 max-h-[40vh] overflow-y-auto">
          <div className="text-xs text-gray-600 mb-2">
            You become one of these characters in the chat. Each one is a real moderation challenge.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {ARCHETYPES.map((a) => (
              <div key={a.name} className="flex items-start gap-2 bg-white border border-gray-200 rounded-md p-2">
                <div
                  className="w-7 h-7 rounded-full text-white text-xs font-semibold flex items-center justify-center shrink-0"
                  style={{ backgroundColor: a.color }}
                >
                  {a.initial}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{a.name}</div>
                  <div className="text-[11px] text-gray-500 truncate">{a.tag}</div>
                  <div className="text-[11px] text-gray-700 mt-0.5">{a.line}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Moderation rules */}
      {tab === "demo" && rulesOpen && (
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 max-h-[50vh] overflow-y-auto">
          <div className="text-xs text-gray-600 mb-2">
            Nine facilitation rules drive every signal you see. Each runs on a specific shape of AI output and writes to a specific table.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {RULES.map((r) => (
              <div key={r.code} className="rounded-md border border-gray-200 bg-white p-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono bg-gray-100 rounded px-1.5 py-0.5">{r.code}</span>
                  <span className="text-xs font-semibold">{r.name}</span>
                  <span className={`text-[9px] ml-auto px-1.5 py-0.5 rounded-full ${r.status === "live" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                    {r.status}
                  </span>
                </div>
                <div className="text-[11px] text-gray-700 leading-snug">{r.logic}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Roadmap */}
      {tab === "demo" && roadmapOpen && (
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 max-h-[55vh] overflow-y-auto">
          <div className="text-xs text-gray-600 mb-2">
            Where we are and where we're going.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(["done", "next", "later"] as const).map((status) => {
              const items = ROADMAP.filter((r) => r.status === status);
              const meta = {
                done: { label: "Shipped", style: "bg-emerald-50 border-emerald-200 text-emerald-700", marker: "✓" },
                next: { label: "Next (phase 3)", style: "bg-sky-50 border-sky-200 text-sky-700", marker: "→" },
                later: { label: "Later (phase 4+)", style: "bg-gray-100 border-gray-200 text-gray-600", marker: "⋯" },
              }[status];
              return (
                <div key={status} className="space-y-2">
                  <div className={`text-[11px] font-semibold rounded px-2 py-1 border ${meta.style}`}>
                    {meta.label} · {items.length}
                  </div>
                  {items.map((r, i) => (
                    <div key={i} className="rounded-md border border-gray-200 bg-white p-2">
                      <div className="flex items-start gap-1.5">
                        <span className="text-gray-400 text-[11px] mt-0.5">{meta.marker}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold">{r.title}</div>
                          <div className="text-[11px] text-gray-700 mt-0.5 leading-snug">{r.line}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {tab === "demo" ? (
          <>
            <div className="flex-1 md:basis-3/5 p-3 min-w-0">
              <ChatSimulator onUpdate={bumpDashboard} onConnection={setChatOk} />
            </div>
            <div className="hidden md:block md:basis-2/5 border-l border-gray-200 min-w-0">
              <Dashboard refreshKey={refreshKey} onConnection={setDashOk} />
            </div>
          </>
        ) : (
          <div className="flex-1 min-w-0">
            <AboutTab />
          </div>
        )}
      </div>

      {/* Mobile drawer (demo tab only) */}
      {tab === "demo" && drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[88%] max-w-md bg-gray-50 shadow-xl">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-xs rounded border border-gray-300 px-2 py-1"
              >
                Close
              </button>
            </div>
            <div className="h-[calc(100%-44px)]">
              <Dashboard refreshKey={refreshKey} onConnection={setDashOk} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

