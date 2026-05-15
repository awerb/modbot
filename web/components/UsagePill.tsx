"use client";
import { useEffect, useState } from "react";
import { jget } from "@/lib/api";

type UsageSummary = {
  total_cost_usd: number;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_model: Record<string, {
    calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost_usd: number;
  }>;
  by_call_type: Record<string, { calls: number; cost_usd: number }>;
};

function fmt$(v: number): string {
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

function fmtK(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default function UsagePill() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const r = await jget<UsageSummary>(`/usage/summary`);
      setData(r);
    } catch {}
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return (
      <span className="text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full border border-gray-300 text-gray-400 bg-gray-50">
        Claude · …
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full border ${
          open
            ? "border-forest bg-forest/5 text-forest"
            : "border-gray-300 hover:bg-gray-50 text-gray-700"
        }`}
        title="Anthropic API cost on this instance"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
        Claude · {fmt$(data.total_cost_usd)} · {data.total_calls} {data.total_calls === 1 ? "call" : "calls"}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-50 w-[360px] max-w-[90vw] bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-[12px]">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-sm">Anthropic usage</div>
              <div className="text-[10px] text-gray-400">refresh every 5s</div>
            </div>

            <div className="bg-gray-50 rounded p-2 mb-2">
              <div className="flex items-baseline justify-between">
                <div className="text-gray-500 text-[11px] uppercase tracking-wider">Total</div>
                <div className="font-semibold text-base">{fmt$(data.total_cost_usd)}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-1.5 text-[11px]">
                <Cell label="Calls" value={String(data.total_calls)} />
                <Cell label="Input" value={fmtK(data.total_input_tokens)} />
                <Cell label="Output" value={fmtK(data.total_output_tokens)} />
              </div>
            </div>

            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">By model</div>
              {Object.keys(data.by_model).length === 0 ? (
                <div className="text-gray-400 italic text-[11px]">No calls yet.</div>
              ) : (
                Object.entries(data.by_model).map(([model, m]) => (
                  <div key={model} className="border border-gray-200 rounded p-1.5 mb-1 last:mb-0">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-[11px] truncate" title={model}>{model}</div>
                      <div className="font-semibold text-[12px]">{fmt$(m.cost_usd)}</div>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {m.calls} calls · in {fmtK(m.input_tokens)} · out {fmtK(m.output_tokens)}
                      {(m.cache_read_tokens > 0 || m.cache_write_tokens > 0) && (
                        <> · cache r/w {fmtK(m.cache_read_tokens)}/{fmtK(m.cache_write_tokens)}</>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">By call type</div>
              {Object.keys(data.by_call_type).length === 0 ? (
                <div className="text-gray-400 italic text-[11px]">—</div>
              ) : (
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(data.by_call_type)
                    .sort(([, a], [, b]) => b.cost_usd - a.cost_usd)
                    .map(([call, c]) => (
                      <div key={call} className="flex items-center justify-between border border-gray-200 rounded px-1.5 py-0.5">
                        <span className="text-[11px] text-gray-700 truncate">{call}</span>
                        <span className="text-[11px] tabular-nums">{fmt$(c.cost_usd)} · {c.calls}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="mt-2 pt-2 border-t text-[10px] text-gray-400">
              Pricing estimates per 1M tokens. See <code>ai.PRICING</code> on the api to adjust.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
