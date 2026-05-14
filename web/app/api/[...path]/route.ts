import { NextRequest, NextResponse } from "next/server";

const UPSTREAM =
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export const dynamic = "force-dynamic";

async function forward(req: NextRequest, ctx: { params: { path: string[] } }) {
  const path = "/" + (ctx.params.path || []).join("/");
  const url = new URL(req.url);
  const target = `${UPSTREAM}${path}${url.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      "content-type": req.headers.get("content-type") || "application/json",
    },
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  const r = await fetch(target, init);
  const text = await r.text();
  return new NextResponse(text, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") || "application/json" },
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
export const PATCH = forward;
