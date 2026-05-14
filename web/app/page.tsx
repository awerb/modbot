"use client";
import { useState } from "react";
import ChatSimulator from "@/components/ChatSimulator";
import Dashboard from "@/components/Dashboard";

export default function Page() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const bumpDashboard = () => setRefreshKey((k) => k + 1);

  return (
    <div className="h-screen w-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-forest text-white font-bold flex items-center justify-center">
            Y
          </div>
          <div>
            <div className="text-sm font-semibold">YGL Mod</div>
            <div className="text-[11px] text-gray-500">
              moderation tool · phase 1 demo
            </div>
          </div>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="md:hidden text-xs rounded border border-gray-300 px-2 py-1"
        >
          Dashboard
        </button>
      </div>

      {/* Main split */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 md:basis-3/5 p-3 min-w-0">
          <ChatSimulator onUpdate={bumpDashboard} />
        </div>
        <div className="hidden md:block md:basis-2/5 border-l border-gray-200 min-w-0">
          <Dashboard refreshKey={refreshKey} />
        </div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
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
              <Dashboard refreshKey={refreshKey} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
