"use client";

export default function AboutTab() {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8 text-gray-800">
        <header>
          <h1 className="text-2xl font-semibold">YGL Mod</h1>
          <p className="text-gray-600 mt-1">
            A moderation tool for small high-trust discussion groups (built for a Young Global Leaders pilot on difficult conversations). The product question: can AI help a human moderator notice the things that actually matter, without taking the human out of the loop?
          </p>
        </header>

        <section>
          <h2 className="text-lg font-semibold mb-2">What's built</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-[14px]">
            <li><b>WhatsApp-style chat simulator</b> with 5 archetype characters you can post as. Optimistic send, day dividers, forwarded labels, click chips to expand AI reasoning.</li>
            <li><b>Moderator dashboard</b> with floor-balance tiles, held forwards, targeted-language flags, topics in play, and a daily suggested question / summary.</li>
            <li><b>AI analysis pipeline</b> on every message: factuality / source check (Haiku), targeting check (Sonnet, with explicit examples that distinguish quoting language from using it), and a deeper classifier for heat, disagreement, steelman, question vs. assertion, and repair detection (Sonnet).</li>
            <li><b>Moderator alerts</b>: pause-suggested when rolling heat stays elevated, steelman-missing on heated disagreements without acknowledgement, repair-detected when someone walks back, exit-velocity when a member goes quiet after a contested exchange, and a quiet-member-contributed badge that surfaces underweighted voices.</li>
            <li><b>Graceful degradation</b>: works without an Anthropic key (heuristic fallback), client-side retry on connection blips, optimistic UI for sends.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Stack</h2>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            <Item title="Backend">FastAPI · SQLAlchemy · Postgres · Anthropic SDK · uvicorn</Item>
            <Item title="Frontend">Next.js 14 (app router) · Tailwind · React 18</Item>
            <Item title="AI">claude-sonnet-4-5 (targeting + deep classification + summary) · claude-haiku-4-5 (factuality / source check)</Item>
            <Item title="Infra">Railway: api service · web service · Postgres plugin · Docker images</Item>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Data model</h2>
          <ul className="list-disc pl-5 space-y-1 text-[13px]">
            <li><code>groups</code>, <code>members</code>, <code>messages</code></li>
            <li><code>analyses</code> per message: factuality / source / has_unsourced_claim, target_flag + category + notes, topic_tags, plus phase 2: heat_score, is_disagreement, steelman_present, is_question, is_assertion, is_repair, repair_notes, references_member_id</li>
            <li><code>group_state</code>: rolling_heat, question_assertion_ratio_7d, last_pause_prompt_at</li>
            <li><code>member_state</code>: last_substantive_post_at, last_contested_exchange_at, silent_since, repair_count, steelman_count</li>
            <li><code>moderator_alerts</code>: kinds = pause_suggested | steelman_missing | repair_detected | exit_velocity | quiet_member_substantive</li>
            <li><code>daily_artifacts</code>: per-day summary and suggested question</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Facilitation rules wired in</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
            <Rule code="R1" name="Floor balance" status="live">Per-member word share, flag outside 10–40%.</Rule>
            <Rule code="R5" name="Forward friction" status="live">Forwarded messages held, moderator must release.</Rule>
            <Rule code="R6" name="Target vs topic" status="live">Sonnet distinguishes targeting language from topic discussion.</Rule>
            <Rule code="R3" name="Heat + pause prompt" status="live">Rolling heat over last 5 messages; sustained ≥0.65 emits a pause-suggested alert with a pre-drafted message.</Rule>
            <Rule code="R2" name="Steelman" status="live">Disagreement messages without steelman_present trigger a yellow icon and a moderator alert.</Rule>
            <Rule code="R9" name="Repair detection" status="live">Apologies / walk-backs / acknowledgements get a green star and are logged to member_state.</Rule>
            <Rule code="R10" name="Exit velocity" status="live">Contested exchange + 48h silence emits exit_velocity alert (moderator-only).</Rule>
            <Rule code="R7" name="Q / A ratio" status="live">Rolling 7d ratio displayed; flagged when assertion-heavy.</Rule>
            <Rule code="R8" name="Quiet-member reward" status="live">Quiet member who posts substantively gets surfaced as an alert and referenced in tomorrow's question.</Rule>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Roadmap</h2>
          <div className="space-y-3 text-[13px]">
            <Block title="Phase 3 — real wiring">
              <ul className="list-disc pl-5 space-y-1">
                <li>Evolution API webhook for real WhatsApp groups (currently stubbed)</li>
                <li>Outbound: moderator-approved pause prompts and steelman invitations get sent back to the group</li>
                <li>Multi-group support (one moderator, several pilots)</li>
                <li>Member-side opt-in and consent flow</li>
              </ul>
            </Block>
            <Block title="Phase 4 — depth">
              <ul className="list-disc pl-5 space-y-1">
                <li>Per-member tone calibration: learn each member's baseline so heat is read relative to them, not in absolute terms</li>
                <li>Thread-level coherence: detect when a debate is talking past itself vs. closing in on a real disagreement</li>
                <li>Source attestation library: track which sources have been credibly used in the group and which have been debunked</li>
                <li>Daily report email to moderator with everything the dashboard shows, plus suggested 1:1 follow-ups</li>
              </ul>
            </Block>
            <Block title="Open questions">
              <ul className="list-disc pl-5 space-y-1">
                <li>How aggressive should auto-flagging be vs. surfacing to the moderator? Current default: never auto-send, always human-approved.</li>
                <li>Heat is calibrated to one type of group; on a more reserved group, heat 0.4 may be the threshold not 0.65. Per-group tuning?</li>
                <li>Should "steelman_missing" alerts age out, or accumulate as a longer-term concern about a member's conversational style?</li>
                <li>Repair detection is generous by design; false positives are OK, false negatives are not. Worth quantifying with a held-out set.</li>
              </ul>
            </Block>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">Endpoints</h2>
          <div className="text-[12px] font-mono bg-gray-50 border border-gray-200 rounded p-3 space-y-0.5">
            <div>GET  /chat/messages</div>
            <div>GET  /chat/members</div>
            <div>POST /test/simulate-message</div>
            <div>POST /analyze/&#123;message_id&#125;</div>
            <div>POST /webhook/evolution  (stub)</div>
            <div>POST /daily/generate</div>
            <div>GET  /dashboard/data</div>
            <div>GET  /alerts</div>
            <div>POST /alerts/&#123;id&#125;/resolve</div>
            <div>GET  /backfill/status</div>
            <div>POST /admin/reseed   (gated by ADMIN_TOKEN when set)</div>
            <div>POST /admin/reanalyze   (gated by ADMIN_TOKEN when set)</div>
          </div>
        </section>

        <footer className="text-[12px] text-gray-500 pt-4 border-t">
          Source: <a className="underline" href="https://github.com/awerb/modbot/tree/demo-day-1">github.com/awerb/modbot</a> · branch <code>demo-day-1</code>
        </footer>
      </div>
    </div>
  );
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 p-3 bg-gray-50">
      <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Rule({ code, name, status, children }: { code: string; name: string; status: "live" | "soon"; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 p-3 bg-white">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-mono bg-gray-100 rounded px-1.5 py-0.5">{code}</span>
        <span className="font-semibold text-[13px]">{name}</span>
        <span className={`text-[10px] ml-auto px-1.5 py-0.5 rounded-full ${status === "live" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
          {status}
        </span>
      </div>
      <div className="text-gray-600">{children}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 p-3 bg-gray-50">
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-gray-700">{children}</div>
    </div>
  );
}
