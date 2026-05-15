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
  { status: "done", title: "Chat simulator + dashboard", line: "WhatsApp-style chat with 5 archetype characters, optimistic send, click-to-expand AI reasoning. Forest-green moderator dashboard with floor balance, held forwards, targeted flags, topics, daily summary." },
  { status: "done", title: "AI analysis pipeline", line: "Factuality / source check (Haiku), targeting check (Sonnet with worked examples for quoting vs. using language), deep classification (Sonnet)." },
  { status: "done", title: "Rules R1, R5, R6", line: "Floor balance, forward friction, target-vs-topic separation." },
  { status: "done", title: "Daily summary + suggested question", line: "Sonnet generates a neutral 4–6 bullet summary and a single seed question that references quiet members by name." },
  { status: "done", title: "Heat, steelman, repair, exit velocity", line: "Rules R2, R3, R9, R10 with moderator alerts. Pause-suggested banner with Sonnet-drafted pause message ready to paste." },
  { status: "done", title: "Q/A ratio + quiet-member reward", line: "Rules R7, R8. Rolling 7d ratio in the dashboard top strip, quiet-member alert and tomorrow's-question integration." },
  { status: "done", title: "Hardening", line: "Admin endpoints token-gated, 7d cap on flagged lists, graceful API fallback when no Anthropic key, optimistic send, AI timeouts." },
  { status: "done", title: "Tests + docs", line: "Pytest suite (26 unit + 15 integration), TypeScript clean, README + ARCHITECTURE + CHANGELOG." },
  { status: "done", title: "Token + cost accounting", line: "Every Claude call captured with token counts and USD cost. Topbar pill shows running total." },
  { status: "done", title: "Mobile-first UI", line: "Bottom tab bar (Chat / Dashboard / About) on phones; secondary actions in a hamburger sheet." },
  { status: "next", title: "Evolution API webhook (real WhatsApp)", line: "Wire /webhook/evolution to a live WhatsApp instance, dedupe by message_id, persist raw_payload." },
  { status: "next", title: "Outbound: moderator-approved sends", line: "Approved pause prompts and steelman invitations get posted back to the group with a moderator byline. Always human-approved, never auto-send." },
  { status: "next", title: "Multi-group support", line: "One moderator, several pilots. Group switcher in the top bar, group_id scoping already in place server-side." },
  { status: "next", title: "Member consent and opt-in flow", line: "Members get a one-time disclosure about what's analyzed and what's stored, plus a way to opt out of specific signals (e.g. heat scoring)." },
  { status: "later", title: "Per-member tone calibration", line: "Heat scored relative to each member's baseline, not absolute. Some members are dispassionate by default, some are intense, both are healthy." },
  { status: "later", title: "Thread coherence", line: "Detect when a debate is talking past itself vs. closing in on a real disagreement. Hard. Probably structured + LLM hybrid." },
  { status: "later", title: "Source attestation library", line: "Track which sources have been credibly used in the group and which have been debunked in-thread. Speeds up factuality_check and gives the moderator continuity." },
  { status: "later", title: "Daily moderator email digest", line: "Everything the dashboard shows, plus suggested 1:1 follow-ups (e.g. who looks like they're about to disengage)." },
];

// View states. On desktop, "dashboard" collapses to "chat" because both render
// side-by-side. On mobile, the three views are mutually exclusive.
type View = "chat" | "dashboard" | "about";

export default function Page() {
  const [view, setView] = useState<View>("chat");
  const [refreshKey, setRefreshKey] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatOk, setChatOk] = useState<boolean | null>(null);
  const [dashOk, setDashOk] = useState<boolean | null>(null);
  const [resetting, setResetting] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);

  const bumpDashboard = () => setRefreshKey((k) => k + 1);

  const connected =
    chatOk === null && dashOk === null
      ? null
      : chatOk !== false && dashOk !== false;

  function togglePanel(name: "legend" | "rules" | "roadmap") {
    if (view === "about") setView("chat");
    setLegendOpen(name === "legend" ? !legendOpen : false);
    setRulesOpen(name === "rules" ? !rulesOpen : false);
    setRoadmapOpen(name === "roadmap" ? !roadmapOpen : false);
    setMenuOpen(false);
  }

  async function resetDemo() {
    if (!confirm("Wipe and reseed the demo data?")) return;
    setMenuOpen(false);
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

  // For the split desktop layout, "chat" and "dashboard" both show the split.
  const showSplit = view === "chat" || view === "dashboard";

  return (
    <div className="h-screen w-screen flex flex-col bg-white">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2 gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-md bg-forest text-white font-bold flex items-center justify-center shrink-0">
            Y
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight truncate">YGL Mod</div>
            <div className="text-[11px] text-gray-500 leading-tight truncate hidden sm:block">moderation simulation</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Desktop only: inline secondary buttons */}
          <div className="hidden lg:flex items-center gap-1.5">
            <button
              onClick={() => setView(view === "about" ? "chat" : "about")}
              className={`text-xs rounded border px-2 py-1 ${view === "about" ? "border-forest bg-forest/5 text-forest" : "border-gray-300 hover:bg-gray-50"}`}
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
              title="Rules driving the signals"
            >
              Rules
            </button>
            <button
              onClick={() => togglePanel("roadmap")}
              className={`text-xs rounded border px-2 py-1 ${roadmapOpen ? "border-forest bg-forest/5 text-forest" : "border-gray-300 hover:bg-gray-50"}`}
            >
              Roadmap
            </button>
            <button
              onClick={resetDemo}
              disabled={resetting}
              className="text-xs rounded border border-gray-300 px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset"}
            </button>
          </div>

          <UsagePill />

          <span
            className={`text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full border ${
              connected === false
                ? "border-red-300 text-red-700 bg-red-50"
                : connected
                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                  : "border-gray-300 text-gray-500 bg-gray-50"
            }`}
            title={connected === false ? "offline" : connected ? "online" : "connecting..."}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected === false ? "bg-red-500" : connected ? "bg-emerald-500" : "bg-gray-400"
              }`}
            />
            <span className="hidden sm:inline">
              {connected === false ? "offline" : connected ? "online" : "..."}
            </span>
          </span>

          {/* Hamburger: visible up to lg */}
          <button
            onClick={() => setMenuOpen(true)}
            className="lg:hidden text-gray-700 hover:bg-gray-100 rounded p-1.5"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* Reference panels: legend / rules / roadmap (compact on mobile, full grid on desktop) */}
      {legendOpen && (
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-600">
              You become one of these in the chat. Each is a real moderation challenge.
            </div>
            <button onClick={() => setLegendOpen(false)} className="text-xs text-gray-400 hover:text-gray-700 lg:hidden">Close</button>
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

      {rulesOpen && (
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 max-h-[55vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-600">
              Nine facilitation rules drive every signal you see.
            </div>
            <button onClick={() => setRulesOpen(false)} className="text-xs text-gray-400 hover:text-gray-700 lg:hidden">Close</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
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

      {roadmapOpen && (
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-3 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-600">Where we are and where we're going.</div>
            <button onClick={() => setRoadmapOpen(false)} className="text-xs text-gray-400 hover:text-gray-700 lg:hidden">Close</button>
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
      <div className="flex-1 flex overflow-hidden min-h-0">
        {view === "about" ? (
          <div className="flex-1 min-w-0">
            <AboutTab />
          </div>
        ) : (
          <>
            {/* Chat: full width on mobile, 60% on desktop */}
            <div
              className={`${
                view === "chat" ? "flex" : "hidden md:flex"
              } flex-1 md:basis-3/5 p-1.5 md:p-3 min-w-0`}
            >
              <div className="flex-1 min-w-0 min-h-0">
                <ChatSimulator onUpdate={bumpDashboard} onConnection={setChatOk} />
              </div>
            </div>
            {/* Dashboard: full width on mobile (when active), 40% on desktop (always) */}
            <div
              className={`${
                view === "dashboard" ? "flex md:block" : "hidden md:block"
              } md:basis-2/5 md:border-l md:border-gray-200 min-w-0 flex-1`}
            >
              <Dashboard refreshKey={refreshKey} onConnection={setDashOk} />
            </div>
          </>
        )}
      </div>

      {/* Bottom tab bar — mobile only */}
      <div className="md:hidden border-t border-gray-200 bg-white grid grid-cols-3 shrink-0 safe-bottom">
        <TabButton active={view === "chat"} label="Chat" onClick={() => setView("chat")} icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        } />
        <TabButton active={view === "dashboard"} label="Dashboard" onClick={() => setView("dashboard")} icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
        } />
        <TabButton active={view === "about"} label="About" onClick={() => setView("about")} icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        } />
      </div>

      {/* Hamburger sheet — mobile and tablet */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[82%] max-w-sm bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-gray-200">
              <div className="text-sm font-semibold">Menu</div>
              <button onClick={() => setMenuOpen(false)} className="text-gray-400 hover:text-gray-700 p-1" aria-label="Close menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="p-3 space-y-1 overflow-y-auto">
              <MenuButton onClick={() => togglePanel("legend")} label="Who's who" hint="5 archetype characters" />
              <MenuButton onClick={() => togglePanel("rules")} label="Moderation rules" hint="R1–R10 explained" />
              <MenuButton onClick={() => togglePanel("roadmap")} label="Roadmap" hint="What's done and next" />
              <div className="border-t my-2" />
              <MenuButton
                onClick={resetDemo}
                disabled={resetting}
                label={resetting ? "Resetting…" : "Reset demo"}
                hint="Wipe and reseed the data"
                danger
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active, label, icon, onClick,
}: { active: boolean; label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
        active ? "text-forest" : "text-gray-500 hover:text-gray-800"
      }`}
    >
      <div className={active ? "scale-110 transition-transform" : ""}>{icon}</div>
      <div className="text-[11px] font-medium">{label}</div>
    </button>
  );
}

function MenuButton({
  onClick, label, hint, disabled, danger,
}: { onClick: () => void; label: string; hint?: string; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-md border px-3 py-2.5 disabled:opacity-50 ${
        danger
          ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
          : "border-gray-200 bg-white hover:bg-gray-50"
      }`}
    >
      <div className="text-sm font-medium">{label}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </button>
  );
}
