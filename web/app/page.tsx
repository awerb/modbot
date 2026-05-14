"use client";
import { useState } from "react";
import ChatSimulator from "@/components/ChatSimulator";
import Dashboard from "@/components/Dashboard";
import AboutTab from "@/components/AboutTab";
import { jpost } from "@/lib/api";

const ARCHETYPES: { initial: string; color: string; name: string; tag: string; line: string }[] = [
  { initial: "A", color: "#0ea5e9", name: "Amara Okonkwo", tag: "Bridge-Builder", line: "Asks questions, summarizes, steelmans before disagreeing." },
  { initial: "M", color: "#dc2626", name: "Michael Standup", tag: "Provocateur", line: "Forwards articles, drops stats without sources, tends to absolutes." },
  { initial: "L", color: "#16a34a", name: "Mei Lin", tag: "Quiet Expert", line: "Posts rarely but with sourced, careful long-form takes." },
  { initial: "R", color: "#f59e0b", name: "Rafael Cardozo", tag: "Personal-Stakes Voice", line: "Brings lived experience; pushes back when others abstract." },
  { initial: "P", color: "#8b5cf6", name: "Priya Anand", tag: "Strident Voice", line: "Names harm directly, emotional, takes the opposite position to Michael." },
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

  const bumpDashboard = () => setRefreshKey((k) => k + 1);

  const connected =
    chatOk === null && dashOk === null
      ? null
      : chatOk !== false && dashOk !== false;

  async function resetDemo() {
    if (!confirm("Wipe and reseed the demo data?")) return;
    setResetting(true);
    try {
      await jpost(`/admin/reseed`, {});
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
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-md bg-forest text-white font-bold flex items-center justify-center">
              Y
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">YGL Mod</div>
              <div className="text-[11px] text-gray-500 leading-tight">moderation tool</div>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <TabBtn active={tab === "demo"} onClick={() => setTab("demo")}>
              Demo
            </TabBtn>
            <TabBtn active={tab === "about"} onClick={() => setTab("about")}>
              About + roadmap
            </TabBtn>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {tab === "demo" && (
            <button
              onClick={() => setLegendOpen((v) => !v)}
              className="text-xs rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
              title="Who are these characters?"
            >
              {legendOpen ? "Hide who's who" : "Who's who"}
            </button>
          )}
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
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded-full transition-colors ${
        active
          ? "bg-forest text-white"
          : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
